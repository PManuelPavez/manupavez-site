-- ============================================================
-- FREQUENCY LAB — Fecha de las sesiones + ciclo de vida de la mentoría
-- A. sessions.session_date_manual: si está cargada, gana sobre la automática.
--    El admin solo puede editar ESA columna (privilegio por columna + RLS).
-- B. memberships_lifecycle(): corre todos los días 09:00 ART (12:00 UTC).
--    1. active que vence en ≤ 3 días → evento membership_expiring (uno por período)
--    2. active vencida → past_due (sin acceso, arrancan 5 días de gracia)
--    3. past_due vencida hace > 5 días → revoked + evento membership_lapsed
--    Un pago durante la gracia ya la vuelve a active con 30 días desde el pago
--    (fulfill_paid_order / mark_order_paid_manual: base = now() si no está activa).
-- ============================================================

-- ── A. Fecha manual de la sesión ──────────────────────────
alter table public.sessions add column if not exists session_date_manual date;

revoke update on public.sessions from authenticated;
grant update (session_date_manual) on public.sessions to authenticated;

drop policy if exists sessions_admin_date on public.sessions;
create policy sessions_admin_date on public.sessions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- El portal muestra la fecha efectiva: la manual si existe, si no la automática
create or replace function public.portal_payload(p_student_id uuid)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  s record;
begin
  select st.id, st.full_name, st.status, m.status as m_status, m.current_period_end
  into s
  from public.students st
  left join public.memberships m on m.student_id = st.id
  where st.id = p_student_id;

  return json_build_object(
    'is_admin', public.is_admin(),
    'student', case when s.id is null then null else json_build_object(
      'id', s.id, 'full_name', s.full_name, 'status', s.status,
      'membership', json_build_object('status', s.m_status, 'current_period_end', s.current_period_end)
    ) end,
    'sessions', coalesce((
      select json_agg(x order by x.number desc nulls last)
      from (select id, number, title, coalesce(session_date_manual, session_date) as session_date, notes, tasks, links
            from public.sessions where student_id = s.id and in_notion) x), '[]'::json),
    'dashboard', (select content from public.student_dashboards where student_id = s.id),
    'tracks', coalesce((
      select json_agg(t order by t.created_at desc)
      from (select id, title, url, created_at from public.student_tracks where student_id = s.id) t), '[]'::json),
    'checks', coalesce((
      select json_object_agg(task_key, done) from public.student_task_checks where student_id = s.id), '{}'::json),
    'material', coalesce((
      select json_agg(mm order by mm.orden)
      from (select titulo, descripcion, tipo_contenido, url_contenido, contenido_texto, orden
            from public.material_alumnos where visible) mm), '[]'::json)
  );
end;
$$;

-- ── B. Avisos de vencimiento ──────────────────────────────
alter table public.lab_events drop constraint if exists lab_events_kind_check;
alter table public.lab_events add constraint lab_events_kind_check
  check (kind in ('track_added', 'task_done', 'membership_expiring', 'membership_lapsed'));

-- Un solo aviso de vencimiento por período (ref_id = membership_id:fecha_fin)
create unique index if not exists lab_events_expiring_once
  on public.lab_events (ref_id) where kind = 'membership_expiring';
create unique index if not exists lab_events_lapsed_once
  on public.lab_events (ref_id) where kind = 'membership_lapsed';

create or replace function public.memberships_lifecycle()
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_expiring int := 0;
  n_past_due int := 0;
  n_revoked int := 0;
begin
  -- 1. Vence en los próximos 3 días → aviso (uno por período)
  with ins as (
    insert into public.lab_events (student_id, kind, ref_id, payload)
    select m.student_id, 'membership_expiring',
           m.id::text || ':' || (m.current_period_end at time zone 'America/Argentina/Buenos_Aires')::date,
           jsonb_build_object('until', m.current_period_end)
    from public.memberships m
    join public.students s on s.id = m.student_id and s.status = 'active'
    where m.status = 'active'
      and m.current_period_end > now()
      and m.current_period_end <= now() + interval '3 days'
    on conflict (ref_id) where kind = 'membership_expiring' do nothing
    returning 1
  )
  select count(*) into n_expiring from ins;

  -- 3. Gracia terminada (> 5 días vencida) → sin acceso definitivo + aviso a Manu
  with lapsed as (
    update public.memberships
       set status = 'revoked'
     where status = 'past_due'
       and current_period_end <= now() - interval '5 days'
    returning id, student_id, current_period_end
  ), ins as (
    insert into public.lab_events (student_id, kind, ref_id, payload)
    select student_id, 'membership_lapsed',
           id::text || ':' || (current_period_end at time zone 'America/Argentina/Buenos_Aires')::date,
           jsonb_build_object('until', current_period_end)
    from lapsed
    on conflict (ref_id) where kind = 'membership_lapsed' do nothing
    returning 1
  )
  select count(*) into n_revoked from lapsed;

  -- 2. Activa ya vencida → gracia (past_due: sin acceso hasta que pague)
  --    Va después del paso 3 para que nadie salte de active a revoked el mismo día.
  update public.memberships
     set status = 'past_due'
   where status = 'active'
     and current_period_end is not null
     and current_period_end <= now();
  get diagnostics n_past_due = row_count;

  return json_build_object('expiring', n_expiring, 'past_due', n_past_due, 'revoked', n_revoked);
end;
$$;

revoke all on function public.memberships_lifecycle() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'memberships-lifecycle';
select cron.schedule('memberships-lifecycle', '0 12 * * *', $$ select public.memberships_lifecycle() $$);
