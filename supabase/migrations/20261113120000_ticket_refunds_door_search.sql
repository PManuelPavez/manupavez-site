-- Devoluciones y búsqueda de puerta (13/11, un día antes del evento)
--
-- · Pago devuelto o desconocido en MercadoPago → la compra pasa a 'refunded' (ticket_refund):
--   sale de la puerta, de la recaudación, de la lista del socio y del panel, y el lugar vuelve a la tanda.
-- · ticket_confirm no vuelve a aprobar una compra devuelta.
-- · door_search busca a cada persona por SU nombre (o por el código de compra), ya no por el del titular.

-- 1. Estado nuevo ------------------------------------------------------------------------------

alter table public.ticket_orders drop constraint ticket_orders_status_check;
alter table public.ticket_orders add constraint ticket_orders_status_check
  check (status in ('pending', 'approved', 'rejected', 'expired', 'refunded'));
alter table public.ticket_orders add column if not exists refunded_at timestamptz;

-- 2. Devolución (solo la usa el webhook, con service_role) --------------------------------------

create or replace function public.ticket_refund(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.ticket_orders;
  v_in boolean;
begin
  select * into o from public.ticket_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.status = 'refunded' then return jsonb_build_object('result', 'already_refunded'); end if;

  if o.status = 'pending' and o.reserved then
    update public.ticket_tiers set reserved = greatest(reserved - o.quantity, 0) where id = o.tier_id;
  elsif o.status = 'approved' and o.method <> 'invitado' and o.tier_id is not null then
    update public.ticket_tiers set sold = greatest(sold - o.quantity, 0) where id = o.tier_id;
  end if;

  select exists (select 1 from public.attendees a where a.order_id = o.id and a.checked_in_at is not null) into v_in;
  update public.ticket_orders set status = 'refunded', reserved = false, refunded_at = now() where id = o.id;
  return jsonb_build_object('result', 'refunded', 'was', o.status, 'checked_in', v_in);
end;
$$;
revoke all on function public.ticket_refund(uuid) from public, anon, authenticated;
grant execute on function public.ticket_refund(uuid) to service_role;

-- 3. Una compra devuelta no se vuelve a aprobar -----------------------------------------------

create or replace function public.ticket_confirm(p_order_id uuid, p_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o public.ticket_orders;
  t public.ticket_tiers;
  v_over boolean := false;
begin
  select * into o from public.ticket_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.status = 'approved' then return jsonb_build_object('result', 'already_approved'); end if;
  if o.status = 'refunded' then return jsonb_build_object('result', 'refunded'); end if;

  select * into t from public.ticket_tiers where id = o.tier_id for update;
  if o.reserved then
    update public.ticket_tiers set reserved = greatest(reserved - o.quantity, 0), sold = sold + o.quantity where id = t.id;
  else
    v_over := t.stock - t.sold - t.reserved < o.quantity;
    update public.ticket_tiers set sold = sold + o.quantity where id = t.id;
  end if;

  update public.ticket_orders
    set status = 'approved', reserved = false, oversold = v_over, mp_payment_id = p_payment_id, paid_at = now()
    where id = o.id;
  return jsonb_build_object('result', 'approved', 'oversold', v_over);
end;
$function$;

-- 4. Puerta: cada persona por su nombre ---------------------------------------------------------

create or replace function public.door_search(p_token text, p_q text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_q text := public._norm(left(coalesce(p_q, ''), 60));
  v_words text[];
  v_n int;
  v_people json;
begin
  select * into v_s from public._door_auth_s(p_token);
  if v_s.event_id is null or v_s.role <> 'door' then return json_build_object('error', 'session'); end if;
  update public.door_sessions set last_seen_at = now() where id = v_s.session_id;

  v_words := array(select w from unnest(string_to_array(trim(v_q), ' ')) w where w <> '');
  if length(array_to_string(v_words, '')) < 3 then return json_build_object('short', true, 'people', '[]'::json); end if;

  -- Cada palabra tiene que estar en el nombre de ESA persona (o ser el código de compra).
  -- El nombre del titular ya no trae a sus acompañantes; queda solo como referencia.
  select count(*), coalesce(json_agg(json_build_object('id', h.id, 'name', h.name,
           'buyer', case when public._norm(h.buyer) <> public._norm(h.name) then h.buyer end,
           'code', h.code, 'tier', h.tier, 'in_at', h.in_at, 'in_by', h.in_by) order by h.ln, h.fn), '[]'::json)
  into v_n, v_people
  from (
    select a.id, trim(a.first_name || ' ' || a.last_name) as name,
           trim(o.buyer_first_name || ' ' || o.buyer_last_name) as buyer,
           upper(left(o.id::text, 8)) as code,
           case when o.method = 'invitado' then 'Invitado' else o.tier_name end as tier,
           a.checked_in_at as in_at, a.checked_in_by as in_by,
           public._norm(a.last_name) as ln, public._norm(a.first_name) as fn
    from public.attendees a join public.ticket_orders o on o.id = a.order_id
    where o.event_id = v_s.event_id and o.status = 'approved'
      and not exists (
        select 1 from unnest(v_words) w
        where position(w in public._norm(a.first_name || ' ' || a.last_name || ' ' || left(o.id::text, 8))) = 0)
    limit 9
  ) h;

  if v_n > 8 then return json_build_object('more', true, 'people', '[]'::json); end if;
  return json_build_object('people', v_people);
end;
$$;
