-- Quitar cargas a mano (13/11): invitados y transferencias cargados desde los paneles.
--
-- · Estado nuevo 'cancelled': sale de la puerta, de la recaudación, de la lista del socio y del panel.
-- · Una transferencia devuelve su lugar a la tanda.
-- · No se puede quitar a alguien que ya entró (primero hay que deshacer el ingreso).
-- · Las compras online (MercadoPago) no se tocan desde acá.
-- · admin_ticket_dashboard ahora devuelve el id de cada pedido (para el botón QUITAR).

alter table public.ticket_orders drop constraint ticket_orders_status_check;
alter table public.ticket_orders add constraint ticket_orders_status_check
  check (status in ('pending', 'approved', 'rejected', 'expired', 'refunded', 'cancelled'));
alter table public.ticket_orders add column if not exists cancelled_at timestamptz;

create or replace function public.admin_remove_manual(p_order_id uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ticket_orders;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.ticket_orders where id = p_order_id for update;
  if o.id is null or o.status <> 'approved' then return json_build_object('error', 'not_found'); end if;
  if o.method not in ('invitado', 'transferencia') or o.added_by is null then
    return json_build_object('error', 'not_manual');
  end if;
  if exists (select 1 from public.attendees a where a.order_id = o.id and a.checked_in_at is not null) then
    return json_build_object('error', 'checked_in');
  end if;

  if o.method = 'transferencia' and o.tier_id is not null then
    update public.ticket_tiers set sold = greatest(sold - o.quantity, 0) where id = o.tier_id;
  end if;
  update public.ticket_orders set status = 'cancelled', cancelled_at = now() where id = o.id;
  return json_build_object('ok', true);
end;
$$;
revoke all on function public.admin_remove_manual(uuid) from public, anon;
grant execute on function public.admin_remove_manual(uuid) to authenticated;

create or replace function public.admin_ticket_dashboard(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev public.events;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_ev from public.events where slug = p_slug;
  if v_ev.id is null then return json_build_object('error', 'event_not_found'); end if;

  return json_build_object(
    'event', json_build_object('name', v_ev.name, 'date', v_ev.event_date, 'venue', v_ev.venue, 'capacity', v_ev.capacity),
    'tiers', coalesce((select json_agg(json_build_object(
        'name', t.name, 'price', t.price_ars, 'stock', t.stock, 'sold', t.sold, 'reserved', t.reserved, 'active', t.active
      ) order by t.sort) from public.ticket_tiers t where t.event_id = v_ev.id), '[]'::json),
    'totals', (select json_build_object(
        'tickets', coalesce(sum(o.quantity) filter (where o.status = 'approved' and o.method <> 'invitado'), 0),
        'guests', coalesce(sum(o.quantity) filter (where o.status = 'approved' and o.method = 'invitado'), 0),
        'revenue', coalesce(sum(o.total_ars) filter (where o.status = 'approved'), 0),
        'orders', count(*) filter (where o.status = 'approved' and o.method <> 'invitado'),
        'pending', coalesce(sum(o.quantity) filter (where o.status = 'pending'), 0)
      ) from public.ticket_orders o where o.event_id = v_ev.id),
    'checked_in', (select count(*) from public.attendees a join public.ticket_orders o on o.id = a.order_id
                   where o.event_id = v_ev.id and o.status = 'approved' and a.checked_in_at is not null),
    'by_rrpp', coalesce((select json_agg(r order by r.tickets desc) from (
        select coalesce(rp.code, 'Sin RRPP') as code, coalesce(rp.name, '—') as name,
               sum(o.quantity) as tickets, sum(o.total_ars) as revenue
        from public.ticket_orders o left join public.rrpp rp on rp.id = o.rrpp_id
        where o.event_id = v_ev.id and o.status = 'approved' and o.method <> 'invitado'
        group by rp.code, rp.name) r), '[]'::json),
    'orders', coalesce((select json_agg(x) from (
        select o.id, o.created_at, o.paid_at, o.status, o.method, o.quantity, o.tier_name, o.total_ars,
               trim(o.buyer_first_name || ' ' || o.buyer_last_name) as buyer, o.buyer_email as email,
               o.buyer_phone as phone, rp.code as rrpp, upper(left(o.id::text, 8)) as code, o.added_by,
               (select json_agg(trim(a.first_name || ' ' || a.last_name) order by a.created_at)
                from public.attendees a where a.order_id = o.id) as people,
               exists (select 1 from public.attendees a where a.order_id = o.id and a.checked_in_at is not null) as checked_in
        from public.ticket_orders o left join public.rrpp rp on rp.id = o.rrpp_id
        where o.event_id = v_ev.id and o.status in ('approved', 'pending')
        order by o.created_at desc limit 300) x), '[]'::json),
    'rrpp', coalesce((select json_agg(json_build_object('id', id, 'name', name, 'code', code, 'active', active) order by name)
                      from public.rrpp), '[]'::json),
    'door_codes', coalesce((select json_agg(json_build_object(
        'id', c.id, 'label', c.label, 'role', c.role, 'active', c.active, 'created_at', c.created_at,
        'sessions', (select count(*) from public.door_sessions s where s.code_id = c.id and s.expires_at > now()),
        'checkins', (select count(*) from public.attendees a where a.checked_in_by = c.label
                     and exists (select 1 from public.ticket_orders o where o.id = a.order_id and o.event_id = v_ev.id))
      ) order by c.created_at) from public.door_codes c where c.event_id = v_ev.id), '[]'::json),
    'waitlist', (select count(*) from public.waitlist w where w.event_id = v_ev.id),
    'fans', (select count(*) from public.fans where unsubscribed_at is null)
  );
end;
$$;
