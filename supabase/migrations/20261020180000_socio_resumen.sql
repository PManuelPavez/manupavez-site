-- Acceso de socio (Facu) al panel de ventas + resumen general para /admin
--
-- · Los códigos de door_codes ahora tienen rol: 'door' (seguridad, 4 dígitos) o 'partner' (socio, 6 dígitos).
--   Cada rol solo abre SUS funciones: un código de puerta no ve recaudación y uno de socio no marca ingresos.
-- · Socio: ve vendidas, recaudado, tandas, adentro e invitados; puede SUMAR invitados (queda registrado
--   quién lo sumó). No ve mails, teléfonos, pedidos, RRPP ni códigos.
-- · admin_overview(): números de todas las áreas para el resumen de /admin (solo is_admin()).

alter table public.door_codes add column if not exists role text not null default 'door'
  check (role in ('door', 'partner'));
alter table public.ticket_orders add column if not exists added_by text;

-- Sesión con rol (reemplaza a _door_session en las funciones de abajo)
create or replace function public._door_auth(p_token text)
returns table (event_id uuid, label text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.event_id, c.label, c.role
  from public.door_sessions s join public.door_codes c on c.id = s.code_id
  where s.token_hash = public._hmac('door-token:' || coalesce(p_token, ''))
    and s.expires_at > now() and c.active;
$$;
revoke all on function public._door_auth(text) from public;

-- Puerta: solo códigos de rol 'door'
create or replace function public.door_login(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := public._hmac('door-ip:' || public._req_ip());
  v_fail_ip int;
  v_fail_all int;
  v_id uuid;
  v_ev uuid;
  v_label text;
  v_name text;
  v_token text;
begin
  perform pg_advisory_xact_lock(hashtext('door_login'));
  select count(*) into v_fail_all from public.door_attempts where not ok and created_at > now() - interval '1 hour';
  if v_fail_all >= 30 then return json_build_object('error', 'locked', 'scope', 'global'); end if;
  select count(*) into v_fail_ip from public.door_attempts
  where ip_hash = v_ip and not ok and created_at > now() - interval '15 minutes';
  if v_fail_ip >= 5 then return json_build_object('error', 'locked', 'scope', 'ip'); end if;

  if coalesce(p_code, '') ~ '^\d{4}$' then
    select c.id, c.event_id, c.label, e.name into v_id, v_ev, v_label, v_name
    from public.door_codes c join public.events e on e.id = c.event_id
    where c.code_hash = public._hmac('door:' || p_code) and c.active and c.role = 'door' and e.active;
  end if;

  if v_id is null then
    insert into public.door_attempts (ip_hash, ok) values (v_ip, false);
    return json_build_object('error', 'invalid', 'remaining', greatest(0, 4 - v_fail_ip));
  end if;

  insert into public.door_attempts (ip_hash, ok) values (v_ip, true);
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.door_sessions (token_hash, code_id, event_id, expires_at)
  values (public._hmac('door-token:' || v_token), v_id, v_ev, now() + interval '16 hours');
  return json_build_object('token', v_token, 'label', v_label, 'event', v_name);
end;
$$;

create or replace function public.door_list(p_token text)
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
  if v_ev is null or v_role <> 'door' then return json_build_object('error', 'session'); end if;

  return json_build_object(
    'label', v_label,
    'event', (select json_build_object('name', name, 'date', event_date) from public.events where id = v_ev),
    'people', coalesce((
      select json_agg(json_build_object(
        'id', a.id,
        'name', trim(a.first_name || ' ' || a.last_name),
        'buyer', trim(o.buyer_first_name || ' ' || o.buyer_last_name),
        'code', upper(left(o.id::text, 8)),
        'tier', case when o.method = 'invitado' then 'Invitado' else o.tier_name end,
        'in_at', a.checked_in_at,
        'in_by', a.checked_in_by
      ) order by public._norm(a.last_name), public._norm(a.first_name))
      from public.attendees a join public.ticket_orders o on o.id = a.order_id
      where o.event_id = v_ev and o.status = 'approved'
    ), '[]'::json)
  );
end;
$$;

create or replace function public.door_checkin(p_token text, p_attendee uuid, p_undo boolean default false)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_label text;
  v_role text;
  v_row record;
begin
  select event_id, label, role into v_ev, v_label, v_role from public._door_auth(p_token);
  if v_ev is null or v_role <> 'door' then return json_build_object('error', 'session'); end if;

  select a.id, a.checked_in_at, a.checked_in_by into v_row
  from public.attendees a join public.ticket_orders o on o.id = a.order_id
  where a.id = p_attendee and o.event_id = v_ev and o.status = 'approved'
  for update of a;
  if v_row.id is null then return json_build_object('error', 'not_found'); end if;

  if p_undo then
    update public.attendees set checked_in_at = null, checked_in_by = null where id = p_attendee;
    return json_build_object('result', 'undone');
  end if;
  if v_row.checked_in_at is not null then
    return json_build_object('result', 'already', 'in_at', v_row.checked_in_at, 'in_by', v_row.checked_in_by);
  end if;
  update public.attendees set checked_in_at = now(), checked_in_by = v_label where id = p_attendee;
  return json_build_object('result', 'ok', 'in_at', now(), 'in_by', v_label);
end;
$$;

-- Socio: login con PIN de 6 números (mismos límites de intentos que la puerta)
create or replace function public.partner_login(p_pin text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := public._hmac('partner-ip:' || public._req_ip());
  v_fail_ip int;
  v_fail_all int;
  v_id uuid;
  v_ev uuid;
  v_label text;
  v_name text;
  v_token text;
begin
  perform pg_advisory_xact_lock(hashtext('door_login'));
  select count(*) into v_fail_all from public.door_attempts where not ok and created_at > now() - interval '1 hour';
  if v_fail_all >= 30 then return json_build_object('error', 'locked', 'scope', 'global'); end if;
  select count(*) into v_fail_ip from public.door_attempts
  where ip_hash = v_ip and not ok and created_at > now() - interval '15 minutes';
  if v_fail_ip >= 5 then return json_build_object('error', 'locked', 'scope', 'ip'); end if;

  if coalesce(p_pin, '') ~ '^\d{6}$' then
    select c.id, c.event_id, c.label, e.name into v_id, v_ev, v_label, v_name
    from public.door_codes c join public.events e on e.id = c.event_id
    where c.code_hash = public._hmac('partner:' || p_pin) and c.active and c.role = 'partner';
  end if;

  if v_id is null then
    insert into public.door_attempts (ip_hash, ok) values (v_ip, false);
    return json_build_object('error', 'invalid', 'remaining', greatest(0, 4 - v_fail_ip));
  end if;

  insert into public.door_attempts (ip_hash, ok) values (v_ip, true);
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.door_sessions (token_hash, code_id, event_id, expires_at)
  values (public._hmac('door-token:' || v_token), v_id, v_ev, now() + interval '7 days');
  return json_build_object('token', v_token, 'label', v_label, 'event', v_name);
end;
$$;

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
    'guests', coalesce((select json_agg(json_build_object(
        'name', trim(o.buyer_first_name || ' ' || o.buyer_last_name), 'added_by', o.added_by, 'created_at', o.created_at,
        'in', exists (select 1 from public.attendees a where a.order_id = o.id and a.checked_in_at is not null)
      ) order by o.created_at desc)
      from public.ticket_orders o where o.event_id = v_ev and o.method = 'invitado' and o.status = 'approved'), '[]'::json)
  );
end;
$$;

create or replace function public.partner_add_guest(p_token text, p_first text, p_last text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_label text;
  v_role text;
  v_order uuid;
  v_cap int;
begin
  select event_id, label, role into v_ev, v_label, v_role from public._door_auth(p_token);
  if v_ev is null or v_role <> 'partner' then return json_build_object('error', 'session'); end if;
  if nullif(trim(p_first), '') is null or nullif(trim(p_last), '') is null then return json_build_object('error', 'name'); end if;
  select capacity into v_cap from public.events where id = v_ev;
  if public._event_used(v_ev) + 1 > v_cap then return json_build_object('error', 'full'); end if;
  insert into public.ticket_orders (event_id, tier_name, quantity, total_ars, buyer_first_name, buyer_last_name,
                                    method, status, paid_at, added_by)
  values (v_ev, 'Invitado', 1, 0, left(trim(p_first), 60), left(trim(p_last), 60), 'invitado', 'approved', now(), v_label)
  returning id into v_order;
  insert into public.attendees (order_id, first_name, last_name) values (v_order, left(trim(p_first), 60), left(trim(p_last), 60));
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.partner_login(text), public.partner_dashboard(text), public.partner_add_guest(text, text, text) from public;
grant execute on function public.partner_login(text), public.partner_dashboard(text), public.partner_add_guest(text, text, text)
  to anon, authenticated;

-- Admin: crear PIN de socio (6 dígitos, se muestra UNA vez)
create or replace function public.admin_partner_pin_create(p_slug text, p_label text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_pin text;
  v_label text := nullif(trim(p_label), '');
  i int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ev from public.events where slug = p_slug;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  if v_label is null then return json_build_object('error', 'label'); end if;
  loop
    i := i + 1;
    v_pin := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when v_pin !~ '^(\d)\1{5}$' and v_pin not in ('123456', '654321', '012345')
      and not exists (select 1 from public.door_codes where code_hash = public._hmac('partner:' || v_pin));
    if i > 50 then return json_build_object('error', 'no_code'); end if;
  end loop;
  insert into public.door_codes (event_id, label, code_hash, role)
  values (v_ev, left(v_label, 40), public._hmac('partner:' || v_pin), 'partner');
  return json_build_object('code', v_pin, 'label', left(v_label, 40));
end;
$$;
revoke all on function public.admin_partner_pin_create(text, text) from public, anon;
grant execute on function public.admin_partner_pin_create(text, text) to authenticated;

-- Invitado sumado por Manu: queda registrado como "Manu"
create or replace function public.admin_add_guest(p_slug text, p_first text, p_last text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_order uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ev from public.events where slug = p_slug;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  if nullif(trim(p_first), '') is null or nullif(trim(p_last), '') is null then return json_build_object('error', 'name'); end if;
  insert into public.ticket_orders (event_id, tier_name, quantity, total_ars, buyer_first_name, buyer_last_name,
                                    method, status, paid_at, added_by)
  values (v_ev, 'Invitado', 1, 0, left(trim(p_first), 60), left(trim(p_last), 60), 'invitado', 'approved', now(), 'Manu')
  returning id into v_order;
  insert into public.attendees (order_id, first_name, last_name) values (v_order, left(trim(p_first), 60), left(trim(p_last), 60));
  return json_build_object('ok', true);
end;
$$;

-- Panel completo (Manu): ahora con el rol de cada código y quién sumó cada invitado
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
        select o.created_at, o.paid_at, o.status, o.method, o.quantity, o.tier_name, o.total_ars,
               trim(o.buyer_first_name || ' ' || o.buyer_last_name) as buyer, o.buyer_email as email,
               o.buyer_phone as phone, rp.code as rrpp, upper(left(o.id::text, 8)) as code, o.added_by,
               (select json_agg(trim(a.first_name || ' ' || a.last_name) order by a.created_at)
                from public.attendees a where a.order_id = o.id) as people
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

-- Resumen de todo para /admin
create or replace function public.admin_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return json_build_object(
    'events', coalesce((select json_agg(json_build_object(
        'slug', e.slug, 'name', e.name, 'date', e.event_date, 'venue', e.venue,
        'tickets', (select coalesce(sum(o.quantity), 0) from public.ticket_orders o
                    where o.event_id = e.id and o.status = 'approved' and o.method <> 'invitado'),
        'guests', (select coalesce(sum(o.quantity), 0) from public.ticket_orders o
                   where o.event_id = e.id and o.status = 'approved' and o.method = 'invitado'),
        'revenue', (select coalesce(sum(o.total_ars), 0) from public.ticket_orders o where o.event_id = e.id and o.status = 'approved'),
        'capacity', e.capacity
      ) order by e.event_date) from public.events e where e.active and e.event_date >= current_date - 1), '[]'::json),
    'fans', (select count(*) from public.fans where unsubscribed_at is null),
    'fans_7d', (select count(*) from public.fans where unsubscribed_at is null and created_at > now() - interval '7 days'),
    'leads_30d', (select count(*) from public.lab_leads where created_at > now() - interval '30 days'),
    'followups_pending', (select count(*) from public.lab_leads where followup_sent_at is null
                          and created_at > now() - interval '7 days'),
    'busy_days_90', (select count(*) from public.booking_busy where day between current_date and current_date + 90),
    'next_busy', (select json_agg(d order by d) from (select day as d from public.booking_busy
                  where day >= current_date order by day limit 5) x),
    'shop_pending', (select count(*) from public.orders where status not in ('paid', 'cancelled')),
    'shop_paid_30d', (select count(*) from public.orders where status = 'paid' and paid_at > now() - interval '30 days')
  );
end;
$$;
revoke all on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;
