-- ============================================================
-- FREQUENCY LAB — Historial semanal, objetivos, "EP listo para enviar", inactivos
-- A. mission_log + dashboard_snapshots + vista weekly_student_log (solo admin).
--    Las escribe notion-sync (service_role) con sync_mission_log() y
--    save_dashboard_snapshot(); nada de esto se expone al portal del alumno.
-- C. Producto "EP listo para enviar" (plan → al pagarse activa/extiende 30 días,
--    igual que la mentoría: fulfill_paid_order y mark_order_paid_manual deciden por kind).
-- D. Favius, Facundo Bainotti y Mateo Manresa → inactivos (no se borra nada).
-- ============================================================

-- ── A. Historial ──────────────────────────────────────────
create table if not exists public.mission_log (
  student_id     uuid not null references public.students (id) on delete cascade,
  task_key       text not null,                 -- id del bloque to_do de Notion
  text           text not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  done_at        timestamptz,                   -- primera vez que se vio tildada (Notion o portal)
  removed_at     timestamptz,                   -- cuándo dejó de estar en la página
  primary key (student_id, task_key)
);

create table if not exists public.dashboard_snapshots (
  id            bigint generated always as identity primary key,
  student_id    uuid not null references public.students (id) on delete cascade,
  captured_at   timestamptz not null default now(),
  content_hash  text not null,
  objectives    text[] not null default '{}',
  diagnosis     text[] not null default '{}',
  missions      jsonb not null default '[]',    -- [{task_key, text, done}]
  wip           text,
  content       jsonb not null                  -- el espejo completo
);
create index if not exists dashboard_snapshots_student_idx on public.dashboard_snapshots (student_id, captured_at desc);

alter table public.mission_log enable row level security;
alter table public.dashboard_snapshots enable row level security;
revoke all on public.mission_log, public.dashboard_snapshots from anon;
revoke insert, update, delete on public.mission_log, public.dashboard_snapshots from authenticated;

drop policy if exists mission_log_admin_read on public.mission_log;
create policy mission_log_admin_read on public.mission_log
  for select to authenticated using (public.is_admin());
drop policy if exists dashboard_snapshots_admin_read on public.dashboard_snapshots;
create policy dashboard_snapshots_admin_read on public.dashboard_snapshots
  for select to authenticated using (public.is_admin());

-- Resumen por alumno y semana (lunes a domingo, hora de Argentina).
-- security_invoker: hereda la RLS de mission_log → solo admin.
create or replace view public.weekly_student_log with (security_invoker = true) as
select
  m.student_id,
  date_trunc('week', m.first_seen_at at time zone 'America/Argentina/Buenos_Aires')::date as week,
  count(*) as missions_assigned,
  count(*) filter (where m.done_at is not null) as missions_done,
  count(*) filter (where m.done_at is null and m.removed_at is not null) as missions_dropped,
  array_agg(m.text order by m.first_seen_at) as mission_texts
from public.mission_log m
group by 1, 2;
revoke all on public.weekly_student_log from anon;

-- Registra las misiones presentes en la página del alumno.
-- p_missions = [{task_key, text, done}] (done = tildada en Notion o en el portal)
create or replace function public.sync_mission_log(p_student_id uuid, p_missions jsonb)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_new int; n_removed int;
begin
  with up as (
    insert into public.mission_log as ml (student_id, task_key, text, done_at)
    select p_student_id, x.task_key, left(x.text, 500), case when x.done then now() end
    from jsonb_to_recordset(coalesce(p_missions, '[]'::jsonb)) as x(task_key text, text text, done boolean)
    where x.task_key is not null and coalesce(x.text, '') <> ''
    on conflict (student_id, task_key) do update
      set last_seen_at = now(),
          text = excluded.text,
          removed_at = null,                                   -- volvió a aparecer
          done_at = coalesce(ml.done_at, excluded.done_at)     -- la primera vez que se tildó
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into n_new from up;

  update public.mission_log
     set removed_at = now()
   where student_id = p_student_id
     and removed_at is null
     and task_key not in (select x.task_key from jsonb_to_recordset(coalesce(p_missions, '[]'::jsonb)) as x(task_key text) where x.task_key is not null);
  get diagnostics n_removed = row_count;

  return json_build_object('new', n_new, 'removed', n_removed);
end;
$$;

-- Guarda una foto de la página solo si cambió respecto de la última
create or replace function public.save_dashboard_snapshot(
  p_student_id uuid, p_hash text, p_objectives text[], p_diagnosis text[],
  p_missions jsonb, p_wip text, p_content jsonb
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from (
      select content_hash from public.dashboard_snapshots
      where student_id = p_student_id order by captured_at desc, id desc limit 1
    ) last where last.content_hash = p_hash
  ) then
    return false;
  end if;
  insert into public.dashboard_snapshots (student_id, content_hash, objectives, diagnosis, missions, wip, content)
  values (p_student_id, p_hash, coalesce(p_objectives, '{}'), coalesce(p_diagnosis, '{}'),
          coalesce(p_missions, '[]'::jsonb), nullif(p_wip, ''), coalesce(p_content, '{}'::jsonb));
  return true;
end;
$$;

revoke all on function public.sync_mission_log(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_dashboard_snapshot(uuid, text, text[], text[], jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.sync_mission_log(uuid, jsonb) to service_role;
grant execute on function public.save_dashboard_snapshot(uuid, text, text[], text[], jsonb, text, jsonb) to service_role;

-- ── C. EP listo para enviar ───────────────────────────────
insert into public.products (slug, name, description, kind, price_usd, unit, max_qty, active, sort)
values ('ep-listo-para-enviar', 'EP listo para enviar',
        'Un mes de mentoría 1:1 más la mezcla de hasta 2 tracks, los masters para enviarlos y la estrategia de envío a sellos.',
        'plan', 90, 'mes', 1, false, 15)
on conflict (slug) do update
  set name = excluded.name, description = excluded.description, kind = excluded.kind,
      price_usd = excluded.price_usd, unit = excluded.unit, max_qty = excluded.max_qty;

-- ── D. Inactivos (no se borra nada) ───────────────────────
update public.students set status = 'inactive'
 where full_name ilike 'Favius%' or full_name ilike 'Facundo Bainotti%' or full_name ilike 'Mateo Manresa%';
