-- ============================================================
-- FREQUENCY LAB — Pagos marcados a mano (transferencia / efectivo)
-- · orders: medio de pago, quién lo marcó y nota.
-- · mark_order_paid_manual(): hace lo mismo que un pago de MercadoPago
--   (pagada + si es la mentoría, activa/extiende 30 días). Solo la llama
--   la Edge Function order-mark-paid (service_role), que ya verificó al admin.
-- · students.email: la base también valida el formato (antes solo la página).
-- ============================================================

alter table public.orders
  add column if not exists payment_method text not null default 'mercadopago'
    check (payment_method in ('mercadopago', 'transferencia', 'efectivo', 'otro')),
  add column if not exists marked_paid_by uuid references auth.users (id) on delete set null,
  add column if not exists manual_note text check (manual_note is null or char_length(manual_note) <= 500);

alter table public.students drop constraint if exists students_email_format;
alter table public.students add constraint students_email_format
  check (email is null or (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 200));

create or replace function public.mark_order_paid_manual(
  p_order_id uuid, p_admin uuid, p_student_id uuid, p_method text, p_note text
) returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders%rowtype;
  sid uuid;
  base timestamptz;
  new_end timestamptz;
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
    select case when m.status = 'active' and m.current_period_end > now()
                then m.current_period_end else now() end
      into base from public.memberships m where m.student_id = sid;
    new_end := coalesce(base, now()) + interval '30 days';
    insert into public.memberships (student_id, status, current_period_end)
    values (sid, 'active', new_end)
    on conflict (student_id) do update
      set status = 'active', current_period_end = excluded.current_period_end;
    update public.orders set fulfilled_at = now() where id = o.id;
    return json_build_object('result', 'paid', 'plan', 'activated', 'until', new_end);
  end if;

  return json_build_object('result', 'paid');
end;
$$;

revoke all on function public.mark_order_paid_manual(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.mark_order_paid_manual(uuid, uuid, uuid, text, text) to service_role;
