-- Tandas que cambian solas por fecha (además de por stock) + nueva fecha y lugar del evento Pergamino.
-- · ticket_tiers.ends_at: desde ese momento la tanda deja de venderse (null = sin fecha de fin).
-- · public_event y ticket_reserve toman la primera tanda activa, con stock y sin vencer.
-- Las órdenes y ventas existentes no se tocan.

alter table public.ticket_tiers add column if not exists ends_at timestamptz;

create or replace function public.public_event(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with ev as (
    select * from public.events where slug = p_slug and active
  ),
  used as (
    select coalesce(sum(t.sold + t.reserved), 0)
         + coalesce((select sum(o.quantity) from public.ticket_orders o, ev
                     where o.event_id = ev.id and o.method = 'invitado' and o.status = 'approved'), 0) as n
    from public.ticket_tiers t, ev where t.event_id = ev.id
  ),
  tiers as (
    select t.*, greatest(t.stock - t.sold - t.reserved, 0) as left_n,
           (t.ends_at is not null and t.ends_at <= now()) as ended
    from public.ticket_tiers t, ev where t.event_id = ev.id
  ),
  cur as (
    select * from tiers where active and left_n > 0 and not ended order by sort limit 1
  )
  select case when not exists (select 1 from ev) then null else jsonb_build_object(
    'slug', ev.slug, 'name', ev.name, 'event_date', ev.event_date, 'venue', ev.venue,
    'address', ev.address, 'time_text', ev.time_text, 'lineup', ev.lineup, 'flyer_url', ev.flyer_url,
    'current', (select jsonb_build_object('id', cur.id, 'name', cur.name, 'price_ars', cur.price_ars,
                  'left', least(cur.left_n, greatest(ev.capacity - (select n from used), 0)),
                  'ends_at', cur.ends_at)
                from cur where ev.capacity > (select n from used)),
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object(
                'name', t.name, 'price_ars', t.price_ars,
                'state', case when t.id = (select id from cur) then 'current'
                              when t.sold >= t.stock or t.ended then 'soldout'
                              else 'next' end) order by t.sort), '[]'::jsonb)
              from tiers t where t.active or t.sold > 0)
  ) end
  from ev;
$$;

create or replace function public.ticket_reserve(
  p_event_id uuid, p_tier_id uuid, p_quantity int,
  p_first_name text, p_last_name text, p_phone text, p_email text,
  p_rrpp_code text, p_attendees jsonb, p_ttl_minutes int default 15
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.events;
  t public.ticket_tiers;
  v_rrpp uuid;
  v_order uuid;
  v_exp timestamptz := now() + make_interval(mins => p_ttl_minutes);
  a jsonb;
begin
  if p_quantity < 1 or p_quantity > 6 then return jsonb_build_object('error', 'invalid_quantity'); end if;
  if jsonb_typeof(p_attendees) <> 'array' or jsonb_array_length(p_attendees) <> p_quantity then
    return jsonb_build_object('error', 'invalid_attendees');
  end if;

  select * into ev from public.events where id = p_event_id and active for update;
  if not found then return jsonb_build_object('error', 'event_not_found'); end if;

  perform 1 from public.ticket_tiers where event_id = ev.id for update;
  select * into t from public.ticket_tiers
    where event_id = ev.id and active and stock - sold - reserved > 0
      and (ends_at is null or ends_at > now())
    order by sort limit 1;
  if not found then return jsonb_build_object('error', 'sold_out'); end if;
  if p_tier_id is not null and p_tier_id <> t.id then
    return jsonb_build_object('error', 'tier_changed', 'tier', t.name, 'price_ars', t.price_ars);
  end if;
  if t.stock - t.sold - t.reserved < p_quantity then
    return jsonb_build_object('error', 'not_enough', 'left', t.stock - t.sold - t.reserved);
  end if;
  if public._event_used(ev.id) + p_quantity > ev.capacity then
    return jsonb_build_object('error', 'not_enough', 'left', greatest(ev.capacity - public._event_used(ev.id), 0));
  end if;

  if nullif(trim(p_rrpp_code), '') is not null then
    select id into v_rrpp from public.rrpp where code = upper(trim(p_rrpp_code)) and active;
  end if;

  update public.ticket_tiers set reserved = reserved + p_quantity where id = t.id;

  insert into public.ticket_orders (event_id, tier_id, tier_name, quantity, unit_price_ars, total_ars,
    buyer_first_name, buyer_last_name, buyer_phone, buyer_email, rrpp_id, method, status, reserved, expires_at)
  values (ev.id, t.id, t.name, p_quantity, t.price_ars, t.price_ars * p_quantity,
    p_first_name, p_last_name, p_phone, lower(p_email), v_rrpp, 'mercadopago', 'pending', true, v_exp)
  returning id into v_order;

  for a in select * from jsonb_array_elements(p_attendees) loop
    insert into public.attendees (order_id, first_name, last_name)
    values (v_order, left(trim(a->>'first_name'), 60), left(trim(a->>'last_name'), 60));
  end loop;

  return jsonb_build_object('order_id', v_order, 'tier', t.name, 'unit_price_ars', t.price_ars,
    'total_ars', t.price_ars * p_quantity, 'expires_at', v_exp);
end;
$$;

-- Datos nuevos (horario de Argentina, UTC-3)
update public.events
   set event_date = '2026-11-14', venue = 'Mandala Indoor'
 where slug = 'pergamino';

-- Acceso anticipado $7.500 hasta el martes 27/10 20:00 · Preventa $9.500 hasta el domingo 01/11 23:59 · después $12.500
update public.ticket_tiers t set ends_at = '2026-10-27 20:00:00-03'
  from public.events e where e.id = t.event_id and e.slug = 'pergamino' and t.sort = 1;
update public.ticket_tiers t set price_ars = 9500, ends_at = '2026-11-01 23:59:59-03'
  from public.events e where e.id = t.event_id and e.slug = 'pergamino' and t.sort = 2 and t.sold = 0;
update public.ticket_tiers t set price_ars = 12500, ends_at = null
  from public.events e where e.id = t.event_id and e.slug = 'pergamino' and t.sort = 3 and t.sold = 0;
