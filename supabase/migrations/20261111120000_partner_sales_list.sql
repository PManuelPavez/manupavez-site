-- Panel del socio: suma la lista de compras (pedido de Manu, 11/11).
-- Por compra ve SOLO: nombre del comprador · cantidad de entradas · tanda · fecha y hora · monto.
-- Sigue sin ver mails, teléfonos, RRPP ni códigos. El resto del panel queda igual.

create or replace function public.partner_dashboard(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_label text;
  v_role text;
begin
  select event_id, label, role into v_ev, v_label, v_role from public._door_auth(p_token);
  if v_ev is null or v_role <> 'partner' then return json_build_object('error', 'session'); end if;

  return json_build_object(
    'label', v_label,
    'event', (select json_build_object('name', name, 'date', event_date, 'venue', venue, 'capacity', capacity)
              from public.events where id = v_ev),
    'tiers', coalesce((select json_agg(json_build_object(
        'name', t.name, 'price', t.price_ars, 'stock', t.stock, 'sold', t.sold, 'reserved', t.reserved, 'active', t.active
      ) order by t.sort) from public.ticket_tiers t where t.event_id = v_ev), '[]'::json),
    'totals', (select json_build_object(
        'tickets', coalesce(sum(o.quantity) filter (where o.status = 'approved' and o.method <> 'invitado'), 0),
        'guests', coalesce(sum(o.quantity) filter (where o.status = 'approved' and o.method = 'invitado'), 0),
        'revenue', coalesce(sum(o.total_ars) filter (where o.status = 'approved'), 0)
      ) from public.ticket_orders o where o.event_id = v_ev),
    'checked_in', (select count(*) from public.attendees a join public.ticket_orders o on o.id = a.order_id
                   where o.event_id = v_ev and o.status = 'approved' and a.checked_in_at is not null),
    -- Compras pagadas (sin invitados), la más reciente primero
    'sales', coalesce((select json_agg(x order by x.at desc) from (
        select trim(o.buyer_first_name || ' ' || o.buyer_last_name) as buyer,
               o.quantity, o.tier_name as tier, coalesce(o.paid_at, o.created_at) as at, o.total_ars as amount
        from public.ticket_orders o
        where o.event_id = v_ev and o.status = 'approved' and o.method <> 'invitado'
        order by coalesce(o.paid_at, o.created_at) desc
        limit 500) x), '[]'::json),
    'guests', coalesce((select json_agg(json_build_object(
        'name', trim(o.buyer_first_name || ' ' || o.buyer_last_name), 'added_by', o.added_by, 'created_at', o.created_at,
        'in', exists (select 1 from public.attendees a where a.order_id = o.id and a.checked_in_at is not null)
      ) order by o.created_at desc)
      from public.ticket_orders o where o.event_id = v_ev and o.method = 'invitado' and o.status = 'approved'), '[]'::json)
  );
end;
$$;
