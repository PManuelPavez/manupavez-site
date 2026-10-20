-- Panel de ventas (/ventas, solo admin) + control de puerta (/puerta, código de 4 dígitos)
--
-- · Puerta: Manu crea códigos de 4 dígitos por evento desde /ventas (se guardan con HMAC, como los PIN).
--   Con el código, seguridad abre una sesión de 16 h (token aleatorio) y ve SOLO la lista de nombres
--   de pedidos aprobados + invitados. Marca INGRESÓ por persona (atómico: dos celulares no lo duplican).
-- · Anti fuerza bruta: 5 fallos por IP en 15 min y 30 fallos por hora en total. Las sesiones ya abiertas
--   siguen andando aunque alguien intente bloquear el login.
-- · Panel: totales por tanda, por RRPP, pedidos, invitados, RRPP y códigos (todo con is_admin()).

-- 1. Columnas y tablas -----------------------------------------------------------

alter table public.attendees
  add column if not exists checked_in_at timestamptz,
  add column if not exists checked_in_by text;

create table public.door_codes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  label text not null,
  code_hash text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.door_sessions (
  token_hash text primary key,
  code_id uuid not null references public.door_codes(id),
  event_id uuid not null references public.events(id),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.door_attempts (
  ip_hash text not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);
create index door_attempts_idx on public.door_attempts (created_at desc, ip_hash);

alter table public.door_codes enable row level security;
alter table public.door_sessions enable row level security;
alter table public.door_attempts enable row level security;
revoke all on public.door_codes, public.door_sessions, public.door_attempts from anon, authenticated;

-- Texto normalizado para buscar / comparar nombres (minúsculas, sin acentos, espacios simples)
create or replace function public._norm(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÀÄÂÃáàäâãÉÈËÊéèëêÍÌÏÎíìïîÓÒÖÔÕóòöôõÚÙÜÛúùüûÑñÇç',
    'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuNnCc')), '\s+', ' ', 'g');
$$;

-- IP del pedido (PostgREST pasa los headers); si no viene, 'unknown'
create or replace function public._req_ip()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(split_part(coalesce(current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
                               current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1), ''),
    'unknown');
$$;

-- 2. Puerta: login, lista y check-in (anónimo con código / token) ---------------------

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
  v_code record;
  v_token text;
begin
  perform pg_advisory_xact_lock(hashtext('door_login'));
  -- (los intentos y sesiones vencidos no se borran: se ignoran por fecha)

  select count(*) into v_fail_all from public.door_attempts where not ok and created_at > now() - interval '1 hour';
  if v_fail_all >= 30 then return json_build_object('error', 'locked', 'scope', 'global'); end if;
  select count(*) into v_fail_ip from public.door_attempts
  where ip_hash = v_ip and not ok and created_at > now() - interval '15 minutes';
  if v_fail_ip >= 5 then return json_build_object('error', 'locked', 'scope', 'ip'); end if;

  if coalesce(p_code, '') ~ '^\d{4}$' then
    select c.id, c.event_id, c.label, e.name into v_code
    from public.door_codes c join public.events e on e.id = c.event_id
    where c.code_hash = public._hmac('door:' || p_code) and c.active and e.active;
  end if;

  if v_code.id is null then
    insert into public.door_attempts (ip_hash, ok) values (v_ip, false);
    return json_build_object('error', 'invalid', 'remaining', greatest(0, 4 - v_fail_ip));
  end if;

  insert into public.door_attempts (ip_hash, ok) values (v_ip, true);
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.door_sessions (token_hash, code_id, event_id, expires_at)
  values (public._hmac('door-token:' || v_token), v_code.id, v_code.event_id, now() + interval '16 hours');
  return json_build_object('token', v_token, 'label', v_code.label, 'event', v_code.name);
end;
$$;

-- Sesión válida → (event_id, label). Null si venció o se desactivó el código.
create or replace function public._door_session(p_token text)
returns table (event_id uuid, label text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.event_id, c.label
  from public.door_sessions s join public.door_codes c on c.id = s.code_id
  where s.token_hash = public._hmac('door-token:' || coalesce(p_token, ''))
    and s.expires_at > now() and c.active;
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
begin
  select event_id, label into v_ev, v_label from public._door_session(p_token);
  if v_ev is null then return json_build_object('error', 'session'); end if;

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
  v_row record;
begin
  select event_id, label into v_ev, v_label from public._door_session(p_token);
  if v_ev is null then return json_build_object('error', 'session'); end if;

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

revoke all on function public.door_login(text), public.door_list(text), public.door_checkin(text, uuid, boolean),
  public._door_session(text), public._norm(text), public._req_ip() from public;
grant execute on function public.door_login(text), public.door_list(text), public.door_checkin(text, uuid, boolean)
  to anon, authenticated;

-- 3. Panel de ventas (solo admin) ------------------------------------------------------

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
               o.buyer_phone as phone, rp.code as rrpp, upper(left(o.id::text, 8)) as code,
               (select json_agg(trim(a.first_name || ' ' || a.last_name) order by a.created_at)
                from public.attendees a where a.order_id = o.id) as people
        from public.ticket_orders o left join public.rrpp rp on rp.id = o.rrpp_id
        where o.event_id = v_ev.id and o.status in ('approved', 'pending')
        order by o.created_at desc limit 300) x), '[]'::json),
    'rrpp', coalesce((select json_agg(json_build_object('id', id, 'name', name, 'code', code, 'active', active) order by name)
                      from public.rrpp), '[]'::json),
    'door_codes', coalesce((select json_agg(json_build_object(
        'id', c.id, 'label', c.label, 'active', c.active, 'created_at', c.created_at,
        'sessions', (select count(*) from public.door_sessions s where s.code_id = c.id and s.expires_at > now()),
        'checkins', (select count(*) from public.attendees a where a.checked_in_by = c.label
                     and exists (select 1 from public.ticket_orders o where o.id = a.order_id and o.event_id = v_ev.id))
      ) order by c.created_at) from public.door_codes c where c.event_id = v_ev.id), '[]'::json),
    'waitlist', (select count(*) from public.waitlist w where w.event_id = v_ev.id),
    'fans', (select count(*) from public.fans where unsubscribed_at is null)
  );
end;
$$;

-- Crea un código de puerta de 4 dígitos (lo devuelve UNA vez; se guarda con HMAC)
create or replace function public.admin_door_code_create(p_slug text, p_label text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_code text;
  v_label text := nullif(trim(p_label), '');
  i int := 0;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ev from public.events where slug = p_slug;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  if v_label is null then return json_build_object('error', 'label'); end if;
  loop
    i := i + 1;
    v_code := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when v_code !~ '^(\d)\1{3}$' and v_code not in ('1234', '4321', '0123', '9876')
      and not exists (select 1 from public.door_codes where code_hash = public._hmac('door:' || v_code));
    if i > 50 then return json_build_object('error', 'no_code'); end if;
  end loop;
  insert into public.door_codes (event_id, label, code_hash) values (v_ev, left(v_label, 40), public._hmac('door:' || v_code));
  return json_build_object('code', v_code, 'label', left(v_label, 40));
end;
$$;

create or replace function public.admin_door_code_toggle(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.door_codes set active = p_active where id = p_id;
  -- Al desactivar, las sesiones abiertas con ese código vencen en el acto
  if not p_active then update public.door_sessions set expires_at = now() where code_id = p_id; end if;
end;
$$;

-- RRPP: alta / edición (código en mayúsculas, 2–20 letras o números)
create or replace function public.admin_rrpp_upsert(p_name text, p_code text, p_active boolean default true)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if v_code !~ '^[A-Z0-9]{2,20}$' then return json_build_object('error', 'code'); end if;
  if nullif(trim(p_name), '') is null then return json_build_object('error', 'name'); end if;
  insert into public.rrpp (name, code, active) values (trim(p_name), v_code, p_active)
  on conflict (code) do update set name = excluded.name, active = excluded.active;
  return json_build_object('ok', true, 'code', v_code);
end;
$$;

-- Invitado (lista de puerta, sin pago ni stock)
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
                                    method, status, paid_at)
  values (v_ev, 'Invitado', 1, 0, left(trim(p_first), 60), left(trim(p_last), 60), 'invitado', 'approved', now())
  returning id into v_order;
  insert into public.attendees (order_id, first_name, last_name) values (v_order, left(trim(p_first), 60), left(trim(p_last), 60));
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.admin_ticket_dashboard(text), public.admin_door_code_create(text, text),
  public.admin_door_code_toggle(uuid, boolean), public.admin_rrpp_upsert(text, text, boolean),
  public.admin_add_guest(text, text, text) from public, anon;
grant execute on function public.admin_ticket_dashboard(text), public.admin_door_code_create(text, text),
  public.admin_door_code_toggle(uuid, boolean), public.admin_rrpp_upsert(text, text, boolean),
  public.admin_add_guest(text, text, text) to authenticated;
