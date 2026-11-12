-- Puerta blindada (antes del evento del 14/11)
--
-- · Sin bloqueos: door_login / partner_login ya no traban el acceso por intentos fallidos.
--   En su lugar, cada intento fallido tarda 1 s y los códigos de puerta pasan a 6 números
--   (1.000.000 de combinaciones). Los intentos se siguen registrando y el panel los muestra.
-- · Códigos de puerta elegidos a mano por Manu (admin_door_code_create con p_code).
-- · La puerta ya no descarga la lista: door_search devuelve solo las coincidencias de lo que se
--   escribe (mínimo 3 letras, máximo 8 resultados). Sin contador ni totales.
-- · "Deshacer" solo desde el panel de Manu (admin_checkin_undo). Todo queda en door_log.
-- · Sesiones visibles en el panel (celular, alta, última actividad) y se pueden cerrar una por una o todas.
-- · El socio ya no ve cuántos entraron.

-- 1. Sesiones con id, dispositivo y última actividad --------------------------------------

alter table public.door_sessions
  add column if not exists id uuid not null default gen_random_uuid(),
  add column if not exists device text,
  add column if not exists last_seen_at timestamptz;
create unique index if not exists door_sessions_id_idx on public.door_sessions (id);

-- Registro de ingresos y deshacer
create table if not exists public.door_log (
  id bigserial primary key,
  event_id uuid not null references public.events(id),
  attendee_id uuid references public.attendees(id) on delete set null,
  action text not null check (action in ('in', 'undo')),
  by_label text,
  session_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists door_log_event_idx on public.door_log (event_id, created_at desc);
alter table public.door_log enable row level security;
revoke all on public.door_log from anon, authenticated;
grant select on public.door_log to authenticated;
drop policy if exists door_log_admin on public.door_log;
create policy door_log_admin on public.door_log for select to authenticated using (public.is_admin());

-- Navegador del pedido (para reconocer cada celular en el panel)
create or replace function public._req_device()
returns text
language sql
stable
set search_path = ''
as $$
  select left(coalesce(current_setting('request.headers', true)::json ->> 'user-agent', ''), 200);
$$;

-- Sesión con id (para registrar quién hizo cada cosa y cerrar sesiones)
create or replace function public._door_auth_s(p_token text)
returns table (session_id uuid, event_id uuid, label text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, s.event_id, c.label, c.role
  from public.door_sessions s join public.door_codes c on c.id = s.code_id
  where s.token_hash = public._hmac('door-token:' || coalesce(p_token, ''))
    and s.expires_at > now() and c.active;
$$;
revoke all on function public._req_device(), public._door_auth_s(text) from public, anon, authenticated;

-- 2. Login sin bloqueos ---------------------------------------------------------------------

create or replace function public.door_login(p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := public._hmac('door-ip:' || public._req_ip());
  v_id uuid;
  v_ev uuid;
  v_label text;
  v_name text;
  v_token text;
begin
  if coalesce(p_code, '') ~ '^\d{6}$' then
    select c.id, c.event_id, c.label, e.name into v_id, v_ev, v_label, v_name
    from public.door_codes c join public.events e on e.id = c.event_id
    where c.code_hash = public._hmac('door:' || p_code) and c.active and c.role = 'door' and e.active;
  end if;

  if v_id is null then
    insert into public.door_attempts (ip_hash, ok) values (v_ip, false);
    perform pg_sleep(1); -- frena a quien prueba códigos, sin trabar a nadie
    return json_build_object('error', 'invalid');
  end if;

  insert into public.door_attempts (ip_hash, ok) values (v_ip, true);
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.door_sessions (token_hash, code_id, event_id, expires_at, device, last_seen_at)
  values (public._hmac('door-token:' || v_token), v_id, v_ev, now() + interval '16 hours', public._req_device(), now());
  return json_build_object('token', v_token, 'label', v_label, 'event', v_name);
end;
$$;

create or replace function public.partner_login(p_pin text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := public._hmac('partner-ip:' || public._req_ip());
  v_id uuid;
  v_ev uuid;
  v_label text;
  v_name text;
  v_token text;
begin
  if coalesce(p_pin, '') ~ '^\d{6}$' then
    select c.id, c.event_id, c.label, e.name into v_id, v_ev, v_label, v_name
    from public.door_codes c join public.events e on e.id = c.event_id
    where c.code_hash = public._hmac('partner:' || p_pin) and c.active and c.role = 'partner';
  end if;

  if v_id is null then
    insert into public.door_attempts (ip_hash, ok) values (v_ip, false);
    perform pg_sleep(1);
    return json_build_object('error', 'invalid');
  end if;

  insert into public.door_attempts (ip_hash, ok) values (v_ip, true);
  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.door_sessions (token_hash, code_id, event_id, expires_at, device, last_seen_at)
  values (public._hmac('door-token:' || v_token), v_id, v_ev, now() + interval '7 days', public._req_device(), now());
  return json_build_object('token', v_token, 'label', v_label, 'event', v_name);
end;
$$;

-- 3. Puerta: solo búsqueda ------------------------------------------------------------------

-- Ya no devuelve la lista (queda por compatibilidad con celulares que tengan la página vieja abierta)
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
    'people', '[]'::json
  );
end;
$$;

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

  -- Hasta 9 coincidencias: si hay más de 8, se pide escribir más (no se listan)
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
        where position(w in public._norm(a.first_name || ' ' || a.last_name || ' ' || o.buyer_first_name || ' '
                                         || o.buyer_last_name || ' ' || left(o.id::text, 8))) = 0)
    limit 9
  ) h;

  if v_n > 8 then return json_build_object('more', true, 'people', '[]'::json); end if;
  return json_build_object('people', v_people);
end;
$$;

-- Ingreso (sin deshacer: eso queda solo para el panel de Manu)
create or replace function public.door_checkin(p_token text, p_attendee uuid, p_undo boolean default false)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_row record;
begin
  select * into v_s from public._door_auth_s(p_token);
  if v_s.event_id is null or v_s.role <> 'door' then return json_build_object('error', 'session'); end if;
  if p_undo then return json_build_object('error', 'forbidden'); end if;
  update public.door_sessions set last_seen_at = now() where id = v_s.session_id;

  select a.id, a.checked_in_at, a.checked_in_by into v_row
  from public.attendees a join public.ticket_orders o on o.id = a.order_id
  where a.id = p_attendee and o.event_id = v_s.event_id and o.status = 'approved'
  for update of a;
  if v_row.id is null then return json_build_object('error', 'not_found'); end if;

  if v_row.checked_in_at is not null then
    return json_build_object('result', 'already', 'in_at', v_row.checked_in_at, 'in_by', v_row.checked_in_by);
  end if;
  update public.attendees set checked_in_at = now(), checked_in_by = v_s.label where id = p_attendee;
  insert into public.door_log (event_id, attendee_id, action, by_label, session_id)
  values (v_s.event_id, p_attendee, 'in', v_s.label, v_s.session_id);
  return json_build_object('result', 'ok', 'in_at', now(), 'in_by', v_s.label);
end;
$$;

revoke all on function public.door_search(text, text) from public;
grant execute on function public.door_search(text, text) to anon, authenticated;

-- 4. Socio: sin "adentro" -------------------------------------------------------------------

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
    'sales', coalesce((select json_agg(x order by x.at desc) from (
        select trim(o.buyer_first_name || ' ' || o.buyer_last_name) as buyer,
               o.quantity, o.tier_name as tier, coalesce(o.paid_at, o.created_at) as at, o.total_ars as amount
        from public.ticket_orders o
        where o.event_id = v_ev and o.status = 'approved' and o.method <> 'invitado'
        order by coalesce(o.paid_at, o.created_at) desc
        limit 500) x), '[]'::json),
    'guests', coalesce((select json_agg(json_build_object(
        'name', trim(o.buyer_first_name || ' ' || o.buyer_last_name), 'added_by', o.added_by, 'created_at', o.created_at
      ) order by o.created_at desc)
      from public.ticket_orders o where o.event_id = v_ev and o.method = 'invitado' and o.status = 'approved'), '[]'::json)
  );
end;
$$;

-- 5. Panel de Manu: códigos a mano, sesiones, lista completa y deshacer ---------------------

drop function if exists public.admin_door_code_create(text, text);
create or replace function public.admin_door_code_create(p_slug text, p_label text, p_code text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_label text := nullif(trim(p_label), '');
  v_code text := trim(coalesce(p_code, ''));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ev from public.events where slug = p_slug;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  if v_label is null then return json_build_object('error', 'label'); end if;
  if v_code !~ '^\d{6}$' then return json_build_object('error', 'code_format'); end if;
  if v_code ~ '^(\d)\1{5}$' or v_code in ('123456', '654321', '012345', '543210', '121212', '112233') then
    return json_build_object('error', 'code_weak');
  end if;
  if exists (select 1 from public.door_codes where code_hash = public._hmac('door:' || v_code)) then
    return json_build_object('error', 'code_taken');
  end if;
  insert into public.door_codes (event_id, label, code_hash) values (v_ev, left(v_label, 40), public._hmac('door:' || v_code));
  return json_build_object('code', v_code, 'label', left(v_label, 40));
end;
$$;

-- Sesiones abiertas + intentos fallidos recientes
create or replace function public.admin_door_sessions(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ev from public.events where slug = p_slug;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  return json_build_object(
    'sessions', coalesce((select json_agg(json_build_object(
        'id', s.id, 'label', c.label, 'role', c.role, 'device', s.device,
        'created_at', s.created_at, 'last_seen_at', s.last_seen_at, 'expires_at', s.expires_at
      ) order by c.role, c.label, s.created_at desc)
      from public.door_sessions s join public.door_codes c on c.id = s.code_id
      where s.event_id = v_ev and s.expires_at > now() and c.active), '[]'::json),
    'failed_1h', (select count(*) from public.door_attempts where not ok and created_at > now() - interval '1 hour'),
    'failed_24h', (select count(*) from public.door_attempts where not ok and created_at > now() - interval '24 hours')
  );
end;
$$;

create or replace function public.admin_door_session_end(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.door_sessions set expires_at = now() where id = p_id and expires_at > now();
end;
$$;

-- Cierra todas las sesiones de un rol ('door', 'partner') o todas si p_role es null
create or replace function public.admin_door_sessions_end_all(p_slug text, p_role text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.door_sessions s set expires_at = now()
  from public.door_codes c, public.events e
  where c.id = s.code_id and e.id = s.event_id and e.slug = p_slug and s.expires_at > now()
    and (p_role is null or c.role = p_role);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Lista completa (para imprimir y para deshacer ingresos)
create or replace function public.admin_door_list(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ev from public.events where slug = p_slug;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  return coalesce((select json_agg(json_build_object(
      'id', a.id, 'first', a.first_name, 'last', a.last_name,
      'buyer', trim(o.buyer_first_name || ' ' || o.buyer_last_name),
      'tier', case when o.method = 'invitado' then 'Invitado' else o.tier_name end,
      'code', upper(left(o.id::text, 8)), 'in_at', a.checked_in_at, 'in_by', a.checked_in_by
    ) order by public._norm(a.last_name), public._norm(a.first_name))
    from public.attendees a join public.ticket_orders o on o.id = a.order_id
    where o.event_id = v_ev and o.status = 'approved'), '[]'::json);
end;
$$;

create or replace function public.admin_checkin_undo(p_attendee uuid)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select o.event_id into v_ev from public.attendees a join public.ticket_orders o on o.id = a.order_id
  where a.id = p_attendee and a.checked_in_at is not null for update of a;
  if v_ev is null then return json_build_object('error', 'not_found'); end if;
  update public.attendees set checked_in_at = null, checked_in_by = null where id = p_attendee;
  insert into public.door_log (event_id, attendee_id, action, by_label) values (v_ev, p_attendee, 'undo', 'Manu (panel)');
  return json_build_object('ok', true);
end;
$$;

revoke all on function public.admin_door_code_create(text, text, text), public.admin_door_sessions(text),
  public.admin_door_session_end(uuid), public.admin_door_sessions_end_all(text, text),
  public.admin_door_list(text), public.admin_checkin_undo(uuid) from public, anon;
grant execute on function public.admin_door_code_create(text, text, text), public.admin_door_sessions(text),
  public.admin_door_session_end(uuid), public.admin_door_sessions_end_all(text, text),
  public.admin_door_list(text), public.admin_checkin_undo(uuid) to authenticated;
