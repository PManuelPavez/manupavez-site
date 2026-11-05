-- Mails a los alumnos: «Actualicé tu portal» (notion_updated) y «Mes confirmado» (membership_paid).
-- lab-notify manda el mail al alumno aparte del resumen a Manu: student_sent_at evita repetirlo
-- si falla el resumen, y student_error + student_attempts permiten reintentar si falla el envío.

-- ── 1. Eventos ──
alter table public.lab_events drop constraint lab_events_kind_check;
alter table public.lab_events add constraint lab_events_kind_check check (kind in
  ('track_added','task_done','membership_expiring','membership_lapsed','notion_updated','membership_paid'));

alter table public.lab_events
  add column student_sent_at timestamptz,
  add column student_error text,
  add column student_attempts int not null default 0;

-- Los avisos de vencimiento ya procesados no se reintentan
update public.lab_events set student_sent_at = sent_at
 where sent_at is not null and kind = 'membership_expiring';

-- Un solo «mes confirmado» por orden
create unique index lab_events_paid_once on public.lab_events (ref_id) where kind = 'membership_paid';

-- Mails al alumno que fallaron y se reintentan (hasta 6 veces, dentro de 3 días)
create index lab_events_student_retry_idx on public.lab_events (created_at)
  where student_sent_at is null and student_error is not null;

-- ── 2. Encolar «mes confirmado» (lo usan las tres vías de pago de un plan) ──
-- first: no tenía período antes. month: órdenes de plan pagadas del alumno, contando esta
-- (la orden ya tiene que tener student_id y status = 'paid').
create or replace function public.lab_enqueue_membership_paid(p_order_id uuid, p_sid uuid, p_first boolean, p_until timestamptz)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_month int;
  v_slug text;
  v_name text;
begin
  select count(*) into v_month from public.orders
   where student_id = p_sid and kind = 'plan' and status = 'paid';
  select p.slug, o.product_name into v_slug, v_name
    from public.orders o left join public.products p on p.id = o.product_id
   where o.id = p_order_id;
  insert into public.lab_events (student_id, kind, ref_id, payload)
  values (p_sid, 'membership_paid', p_order_id::text, jsonb_build_object(
    'order_id', p_order_id, 'product_slug', v_slug, 'product_name', v_name,
    'until', p_until, 'first', p_first, 'month', greatest(v_month, 1)))
  on conflict do nothing;
end;
$$;
revoke all on function public.lab_enqueue_membership_paid(uuid, uuid, boolean, timestamptz) from public, anon, authenticated;

-- ── 3. Pago por MercadoPago ──
create or replace function public.fulfill_paid_order(p_order_id uuid, p_payment_id text)
returns json
language plpgsql
security definer
set search_path to ''
as $function$
declare
  o public.orders%rowtype;
  sid uuid;
  base timestamptz;
  new_end timestamptz;
  prev_end timestamptz;
  v_first boolean;
begin
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then return json_build_object('result', 'not_found'); end if;
  if o.status = 'paid' then return json_build_object('result', 'already_paid'); end if;

  update public.orders
     set status = 'paid', mp_payment_id = p_payment_id, paid_at = now()
   where id = o.id;

  if o.kind = 'plan' then
    sid := coalesce(o.student_id, (select id from public.students where email = lower(o.buyer_email) limit 1));
    if sid is null then
      return json_build_object('result', 'paid', 'plan', 'no_student');
    end if;
    select m.current_period_end,
           case when m.status = 'active' and m.current_period_end > now() then m.current_period_end else now() end
      into prev_end, base from public.memberships m where m.student_id = sid;
    v_first := prev_end is null;
    new_end := coalesce(base, now()) + interval '30 days';
    insert into public.memberships (student_id, status, current_period_end)
    values (sid, 'active', new_end)
    on conflict (student_id) do update set status = 'active', current_period_end = excluded.current_period_end;
    update public.orders set student_id = sid, fulfilled_at = now() where id = o.id;
    perform public.lab_enqueue_membership_paid(o.id, sid, v_first, new_end);
    return json_build_object('result', 'paid', 'plan', 'activated', 'until', new_end);
  end if;

  return json_build_object('result', 'paid', 'plan', null);
end;
$function$;

-- ── 4. Pago marcado a mano ──
create or replace function public.mark_order_paid_manual(p_order_id uuid, p_admin uuid, p_student_id uuid, p_method text, p_note text)
returns json
language plpgsql
security definer
set search_path to ''
as $function$
declare
  o public.orders%rowtype;
  sid uuid;
  base timestamptz;
  new_end timestamptz;
  prev_end timestamptz;
  v_first boolean;
begin
  if p_method not in ('transferencia', 'efectivo', 'otro') then
    return json_build_object('result', 'invalid_method');
  end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then return json_build_object('result', 'not_found'); end if;
  if o.status = 'paid' then return json_build_object('result', 'already_paid'); end if;
  if o.status not in ('pending', 'expired') then
    return json_build_object('result', 'invalid_status', 'status', o.status);
  end if;

  sid := coalesce(p_student_id, o.student_id);
  if sid is not null and not exists (select 1 from public.students where id = sid) then
    return json_build_object('result', 'student_not_found');
  end if;
  if o.kind = 'plan' and sid is null then return json_build_object('result', 'student_required'); end if;

  update public.orders
     set status = 'paid', paid_at = now(), payment_method = p_method,
         marked_paid_by = p_admin, manual_note = nullif(btrim(p_note), ''),
         student_id = coalesce(sid, student_id)
   where id = o.id;

  if o.kind = 'plan' then
    select m.current_period_end,
           case when m.status = 'active' and m.current_period_end > now() then m.current_period_end else now() end
      into prev_end, base from public.memberships m where m.student_id = sid;
    v_first := prev_end is null;
    new_end := coalesce(base, now()) + interval '30 days';
    insert into public.memberships (student_id, status, current_period_end)
    values (sid, 'active', new_end)
    on conflict (student_id) do update
      set status = 'active', current_period_end = excluded.current_period_end;
    update public.orders set fulfilled_at = now() where id = o.id;
    perform public.lab_enqueue_membership_paid(o.id, sid, v_first, new_end);
    return json_build_object('result', 'paid', 'plan', 'activated', 'until', new_end);
  end if;

  return json_build_object('result', 'paid');
end;
$function$;

-- ── 5. Caso no_student: asignar alumno a una orden de plan pagada por MP sin alumno ──
-- Desde el panel (admin). Activa/extiende 30 días y encola el «mes confirmado».
create or replace function public.admin_assign_plan_order(p_order_id uuid, p_student_id uuid)
returns json
language plpgsql
security definer
set search_path to ''
as $function$
declare
  o public.orders%rowtype;
  base timestamptz;
  new_end timestamptz;
  prev_end timestamptz;
  v_first boolean;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then return json_build_object('result', 'not_found'); end if;
  if o.kind <> 'plan' or o.status <> 'paid' then return json_build_object('result', 'invalid_status'); end if;
  if o.fulfilled_at is not null then return json_build_object('result', 'already_fulfilled'); end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    return json_build_object('result', 'student_not_found');
  end if;

  select m.current_period_end,
         case when m.status = 'active' and m.current_period_end > now() then m.current_period_end else now() end
    into prev_end, base from public.memberships m where m.student_id = p_student_id;
  v_first := prev_end is null;
  new_end := coalesce(base, now()) + interval '30 days';
  insert into public.memberships (student_id, status, current_period_end)
  values (p_student_id, 'active', new_end)
  on conflict (student_id) do update set status = 'active', current_period_end = excluded.current_period_end;
  update public.orders set student_id = p_student_id, fulfilled_at = now() where id = o.id;
  perform public.lab_enqueue_membership_paid(o.id, p_student_id, v_first, new_end);
  return json_build_object('result', 'activated', 'until', new_end);
end;
$function$;
revoke all on function public.admin_assign_plan_order(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_plan_order(uuid, uuid) to authenticated;

-- ── 6. Aviso «Actualicé tu portal» desde admin.html (mismo insert que el panel) ──
create or replace function public.admin_notify_portal(p_student_id uuid, p_note text)
returns json
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    return json_build_object('result', 'student_not_found');
  end if;
  insert into public.lab_events (student_id, kind, ref_id, payload)
  values (p_student_id, 'notion_updated', 'notion_updated:' || to_char(now(), 'YYYYMMDDHH24MISS'),
          jsonb_build_object('note', left(btrim(coalesce(p_note, '')), 500), 'by', 'admin'));
  return json_build_object('result', 'queued');
end;
$function$;
revoke all on function public.admin_notify_portal(uuid, text) from public, anon;
grant execute on function public.admin_notify_portal(uuid, text) to authenticated;

-- ── 7. El cron también corre si hay mails al alumno para reintentar ──
select cron.alter_job(
  (select jobid from cron.job where jobname = 'lab-notify-5min'),
  command := $cmd$
  select net.http_post(
    url := 'https://psnprhzowknhfylvgcci.supabase.co/functions/v1/lab-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lab_notify_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from public.lab_events
    where sent_at is null and created_at < now() - interval '2 minutes'
  ) or exists (
    select 1 from public.lab_events
    where student_sent_at is null and student_error is not null and student_error <> 'sin_email'
      and student_attempts < 6 and created_at > now() - interval '3 days'
  );
  $cmd$
);
