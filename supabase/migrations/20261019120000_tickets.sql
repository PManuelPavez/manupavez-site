-- Venta de entradas (evento Pergamino 13/11/2026)
--
-- · events / ticket_tiers / rrpp / ticket_orders / attendees / waitlist
-- · Nada es legible desde la web pública: la página lee public_event() (sin vendidas ni datos personales)
--   y la Edge Function tickets-checkout (service_role) llama a las RPC de reserva.
-- · Stock: sold (pagadas) + reserved (pedidos pending, 15 min). Todo pasa por ticket_reserve/confirm/release,
--   que bloquean las filas (FOR UPDATE) para no vender de más.
-- · Tanda actual = la primera activa (por orden) con lugar. Cuando una se agota, sigue la próxima sola.

-- 1. Tablas -----------------------------------------------------------------

create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name text not null,
  event_date date not null,
  venue text,
  address text,
  time_text text,
  lineup jsonb not null default '[]'::jsonb,
  flyer_url text check (flyer_url is null or flyer_url ~ '^https://'),
  capacity int not null default 200 check (capacity > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.ticket_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  price_ars int not null check (price_ars > 0),
  stock int not null check (stock >= 0),
  sold int not null default 0 check (sold >= 0),
  reserved int not null default 0 check (reserved >= 0),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index ticket_tiers_event_idx on public.ticket_tiers (event_id, sort);

create table public.rrpp (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null check (code ~ '^[A-Z0-9]{2,20}$'),
  pin_hash text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index rrpp_code_idx on public.rrpp (code);

create table public.ticket_orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  tier_id uuid references public.ticket_tiers(id),          -- null en invitados
  tier_name text,
  quantity int not null check (quantity between 1 and 50),
  unit_price_ars int not null default 0,
  total_ars int not null default 0 check (total_ars >= 0),
  buyer_first_name text not null,
  buyer_last_name text not null,
  buyer_phone text,
  buyer_email text check (buyer_email is null or buyer_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  rrpp_id uuid references public.rrpp(id),
  method text not null check (method in ('mercadopago', 'transferencia', 'invitado')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  reserved boolean not null default false,                   -- si hoy tiene stock reservado
  oversold boolean not null default false,                   -- aprobado tarde sin lugar en la tanda
  mp_payment_id text,
  mp_preference_id text,
  init_point text,
  expires_at timestamptz,
  paid_at timestamptz,
  email_sent_at timestamptz,
  email_error text,
  created_at timestamptz not null default now()
);
create index ticket_orders_event_idx on public.ticket_orders (event_id, status, created_at);
create index ticket_orders_pending_idx on public.ticket_orders (expires_at) where status = 'pending';
create index ticket_orders_email_idx on public.ticket_orders (buyer_email, created_at);

create table public.attendees (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ticket_orders(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  created_at timestamptz not null default now()
);
create index attendees_order_idx on public.attendees (order_id);

create table public.waitlist (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  phone text,
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, email)
);

-- Idempotencia del webhook de entradas
create table public.ticket_payment_events (
  id text primary key,
  order_id uuid references public.ticket_orders(id) on delete set null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- 2. RLS: solo el admin lee/escribe; la web pública usa public_event() -------

alter table public.events enable row level security;
alter table public.ticket_tiers enable row level security;
alter table public.rrpp enable row level security;
alter table public.ticket_orders enable row level security;
alter table public.attendees enable row level security;
alter table public.waitlist enable row level security;
alter table public.ticket_payment_events enable row level security;

revoke all on public.events, public.ticket_tiers, public.rrpp, public.ticket_orders,
  public.attendees, public.waitlist, public.ticket_payment_events from anon;

create policy events_admin on public.events for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy ticket_tiers_admin on public.ticket_tiers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy rrpp_admin on public.rrpp for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy ticket_orders_admin on public.ticket_orders for select to authenticated
  using (public.is_admin());
create policy attendees_admin on public.attendees for select to authenticated
  using (public.is_admin());
create policy waitlist_admin on public.waitlist for select to authenticated
  using (public.is_admin());
-- ticket_payment_events: sin políticas (solo service_role)

-- 3. Info pública del evento ------------------------------------------------
-- Devuelve el evento, la tanda actual con "quedan X" y el estado de las demás.
-- Nunca el total vendido ni la capacidad usada.

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
    select t.*, greatest(t.stock - t.sold - t.reserved, 0) as left_n
    from public.ticket_tiers t, ev where t.event_id = ev.id
  ),
  cur as (
    select * from tiers where active and left_n > 0 order by sort limit 1
  )
  select case when not exists (select 1 from ev) then null else jsonb_build_object(
    'slug', ev.slug, 'name', ev.name, 'event_date', ev.event_date, 'venue', ev.venue,
    'address', ev.address, 'time_text', ev.time_text, 'lineup', ev.lineup, 'flyer_url', ev.flyer_url,
    'current', (select jsonb_build_object('id', cur.id, 'name', cur.name, 'price_ars', cur.price_ars,
                  'left', least(cur.left_n, greatest(ev.capacity - (select n from used), 0)))
                from cur where ev.capacity > (select n from used)),
    'tiers', (select coalesce(jsonb_agg(jsonb_build_object(
                'name', t.name, 'price_ars', t.price_ars,
                'state', case when t.id = (select id from cur) then 'current'
                              when t.sold >= t.stock then 'soldout'
                              else 'next' end) order by t.sort), '[]'::jsonb)
              from tiers t where t.active or t.sold > 0)
  ) end
  from ev;
$$;
revoke all on function public.public_event(text) from public;
grant execute on function public.public_event(text) to anon, authenticated, service_role;

-- Estado de un pedido para la vuelta de MercadoPago (el id es un uuid imposible de adivinar)
create or replace function public.ticket_order_status(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('status', status, 'quantity', quantity, 'email_sent', email_sent_at is not null)
  from public.ticket_orders where id = p_order_id and method = 'mercadopago';
$$;
revoke all on function public.ticket_order_status(uuid) from public;
grant execute on function public.ticket_order_status(uuid) to anon, authenticated, service_role;

-- 4. Reserva / confirmación / liberación (solo service_role) ----------------

-- Lugares ocupados del evento (pagadas + reservadas + invitados)
create or replace function public._event_used(p_event_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select (coalesce((select sum(sold + reserved) from public.ticket_tiers where event_id = p_event_id), 0)
        + coalesce((select sum(quantity) from public.ticket_orders
                    where event_id = p_event_id and method = 'invitado' and status = 'approved'), 0))::int;
$$;

-- Crea el pedido pending y reserva el stock de la tanda actual.
-- p_attendees: [{"first_name": "...", "last_name": "..."}, ...] (uno por entrada)
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

  -- Bloquea todas las tandas del evento: la reserva es atómica
  perform 1 from public.ticket_tiers where event_id = ev.id for update;
  select * into t from public.ticket_tiers
    where event_id = ev.id and active and stock - sold - reserved > 0
    order by sort limit 1;
  if not found then return jsonb_build_object('error', 'sold_out'); end if;
  -- El comprador vio otra tanda (cambió mientras completaba): que vuelva a mirar el precio
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

-- Pago aprobado. Si la reserva ya se había liberado (pago tarde), vuelve a tomar el lugar;
-- si no hay lugar, se aprueba igual (la persona pagó) y queda marcado oversold para avisar.
create or replace function public.ticket_confirm(p_order_id uuid, p_payment_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.ticket_orders;
  t public.ticket_tiers;
  v_over boolean := false;
begin
  select * into o from public.ticket_orders where id = p_order_id for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.status = 'approved' then return jsonb_build_object('result', 'already_approved'); end if;

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
$$;

-- Pago rechazado o pedido vencido: libera la reserva
create or replace function public.ticket_release(p_order_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.ticket_orders;
begin
  if p_status not in ('rejected', 'expired') then return jsonb_build_object('error', 'invalid_status'); end if;
  select * into o from public.ticket_orders where id = p_order_id for update;
  if not found or o.status <> 'pending' then return jsonb_build_object('result', 'noop'); end if;
  if o.reserved then
    update public.ticket_tiers set reserved = greatest(reserved - o.quantity, 0) where id = o.tier_id;
  end if;
  update public.ticket_orders set status = p_status, reserved = false where id = o.id;
  return jsonb_build_object('result', p_status);
end;
$$;

-- Cron: vence los pedidos pending pasados los 15 minutos
create or replace function public.ticket_expire_stale()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in select id from public.ticket_orders where status = 'pending' and expires_at < now() loop
    perform public.ticket_release(r.id, 'expired');
    n := n + 1;
  end loop;
  return n;
end;
$$;

revoke all on function public._event_used(uuid) from public, anon, authenticated;
revoke all on function public.ticket_reserve(uuid, uuid, int, text, text, text, text, text, jsonb, int) from public, anon, authenticated;
revoke all on function public.ticket_confirm(uuid, text) from public, anon, authenticated;
revoke all on function public.ticket_release(uuid, text) from public, anon, authenticated;
revoke all on function public.ticket_expire_stale() from public, anon, authenticated;
grant execute on function public._event_used(uuid) to service_role;
grant execute on function public.ticket_reserve(uuid, uuid, int, text, text, text, text, text, jsonb, int) to service_role;
grant execute on function public.ticket_confirm(uuid, text) to service_role;
grant execute on function public.ticket_release(uuid, text) to service_role;
grant execute on function public.ticket_expire_stale() to service_role;

select cron.schedule('tickets-expire-5min', '*/5 * * * *', $$ select public.ticket_expire_stale() $$);

-- 5. Datos iniciales ----------------------------------------------------------

with ev as (
  insert into public.events (slug, name, event_date, lineup, capacity)
  values ('pergamino', 'Manu Pavez en Pergamino', '2026-11-13',
          '[{"name": "Manu Pavez", "role": "Main"}, {"name": "Facu Arce", "role": "Warm up"}]'::jsonb, 200)
  returning id
)
insert into public.ticket_tiers (event_id, name, price_ars, stock, sort, active)
select ev.id, v.name, v.price, v.stock, v.sort, v.active
from ev, (values
  ('Early', 13000, 50, 1, true),
  ('Preventa', 14500, 80, 2, true),
  ('General', 16500, 70, 3, true),
  ('Final', 19500, 0, 4, false)
) as v(name, price, stock, sort, active);
