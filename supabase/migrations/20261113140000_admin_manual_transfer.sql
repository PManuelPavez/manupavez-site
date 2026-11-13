-- Carga manual desde el panel de Manu: invitado o pago por transferencia (13/11).
--
-- · Una persona por carga (así la puerta la encuentra por su nombre).
-- · Transferencia: entra como venta pagada de la tanda actual (cuenta en recaudación, entradas,
--   capacidad y en la lista del socio). Monto: el que escribe Manu; si lo deja vacío, el precio de la tanda.
-- · Invitado: igual que admin_add_guest.

create or replace function public.admin_add_manual(p_slug text, p_first text, p_last text, p_method text, p_amount int default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_order uuid;
  v_first text := left(trim(coalesce(p_first, '')), 60);
  v_last text := left(trim(coalesce(p_last, '')), 60);
  t public.ticket_tiers;
  v_amount int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ev from public.events where slug = p_slug for update;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  if v_first = '' or v_last = '' then return json_build_object('error', 'name'); end if;
  if p_method not in ('invitado', 'transferencia') then return json_build_object('error', 'method'); end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 10000000) then return json_build_object('error', 'amount'); end if;

  if p_method = 'invitado' then
    insert into public.ticket_orders (event_id, tier_name, quantity, total_ars, buyer_first_name, buyer_last_name,
                                      method, status, paid_at, added_by)
    values (v_ev, 'Invitado', 1, 0, v_first, v_last, 'invitado', 'approved', now(), 'Manu')
    returning id into v_order;
  else
    -- Tanda actual (misma regla que la venta online); si no hay ninguna abierta, la última activa
    perform 1 from public.ticket_tiers where event_id = v_ev for update;
    select * into t from public.ticket_tiers
      where event_id = v_ev and active and stock - sold - reserved > 0 and (ends_at is null or ends_at > now())
      order by sort limit 1;
    if t.id is null then
      select * into t from public.ticket_tiers where event_id = v_ev and active order by sort desc limit 1;
    end if;
    v_amount := coalesce(p_amount, t.price_ars, 0);
    if t.id is not null then
      update public.ticket_tiers set sold = sold + 1 where id = t.id;
    end if;
    insert into public.ticket_orders (event_id, tier_id, tier_name, quantity, unit_price_ars, total_ars,
                                      buyer_first_name, buyer_last_name, method, status, paid_at, added_by)
    values (v_ev, t.id, coalesce(t.name, 'Transferencia'), 1, v_amount, v_amount,
            v_first, v_last, 'transferencia', 'approved', now(), 'Manu')
    returning id into v_order;
  end if;

  insert into public.attendees (order_id, first_name, last_name) values (v_order, v_first, v_last);
  return json_build_object('ok', true, 'method', p_method, 'tier', case when p_method = 'invitado' then 'Invitado' else coalesce(t.name, 'Transferencia') end,
                           'amount', case when p_method = 'invitado' then 0 else v_amount end);
end;
$$;
revoke all on function public.admin_add_manual(text, text, text, text, int) from public, anon;
grant execute on function public.admin_add_manual(text, text, text, text, int) to authenticated;
