-- ============================================================
-- FREQUENCY LAB — Paso 3/4: shop + órdenes (MercadoPago)
-- · products: catálogo. Sin precio = no se vende (los precios los pone el admin).
-- · product_items: packs = combinación de productos (listo para el futuro).
-- · orders: CADA orden guarda su propio precio (público o especial del admin),
--   la cotización MEP del momento y el monto en ARS. No se recalcula después.
-- · Las órdenes solo las crea/actualiza el servidor (Edge Functions).
-- También: vista previa del alumno para el admin, material oculto, cuenta de prueba borrada.
-- ============================================================

-- ── Limpieza pedida ────────────────────────────────────────
update public.material_alumnos set visible = false;             -- contenido de ejemplo
delete from public.students where full_name = 'Manu Pavez (PRUEBA)'; -- y en cascada sus copias

-- ── Portal: un solo armado para el alumno y para la vista previa del admin ──
create or replace function public.portal_payload(p_student_id uuid)
returns json
language plpgsql
stable
security invoker          -- RLS decide: un alumno no puede leer a otro
set search_path = ''
as $$
declare
  s record;
begin
  select st.id, st.full_name, st.status, m.status as m_status, m.current_period_end
  into s
  from public.students st
  left join public.memberships m on m.student_id = st.id
  where st.id = p_student_id;

  return json_build_object(
    'is_admin', public.is_admin(),
    'student', case when s.id is null then null else json_build_object(
      'id', s.id, 'full_name', s.full_name, 'status', s.status,
      'membership', json_build_object('status', s.m_status, 'current_period_end', s.current_period_end)
    ) end,
    'sessions', coalesce((
      select json_agg(x order by x.number desc nulls last)
      from (select id, number, title, session_date, notes, tasks, links
            from public.sessions where student_id = s.id and in_notion) x), '[]'::json),
    'dashboard', (select content from public.student_dashboards where student_id = s.id),
    'tracks', coalesce((
      select json_agg(t order by t.created_at desc)
      from (select id, title, url, created_at from public.student_tracks where student_id = s.id) t), '[]'::json),
    'checks', coalesce((
      select json_object_agg(task_key, done) from public.student_task_checks where student_id = s.id), '{}'::json),
    'material', coalesce((
      select json_agg(mm order by mm.orden)
      from (select titulo, descripcion, tipo_contenido, url_contenido, contenido_texto, orden
            from public.material_alumnos where visible) mm), '[]'::json)
  );
end;
$$;

drop function if exists public.get_my_portal();
create function public.get_my_portal()
returns json
language sql
stable
security invoker
set search_path = ''
as $$
  select public.portal_payload(
    (select id from public.students where user_id = (select auth.uid()) limit 1)
  );
$$;

-- Vista previa: el admin ve la página de un alumno tal cual la ve él
create or replace function public.admin_student_portal(p_student_id uuid)
returns json
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return public.portal_payload(p_student_id);
end;
$$;

revoke all on function public.portal_payload(uuid), public.get_my_portal(), public.admin_student_portal(uuid) from public, anon;
grant execute on function public.portal_payload(uuid), public.get_my_portal(), public.admin_student_portal(uuid) to authenticated;

-- ── Catálogo ──────────────────────────────────────────────
create table if not exists public.products (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  name         text not null check (char_length(name) between 2 and 120),
  description  text check (char_length(description) <= 600),
  kind         text not null check (kind in ('service', 'plan', 'pack')),
  price_usd    numeric(10, 2) check (price_usd is null or price_usd > 0),
  active       boolean not null default false,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.product_items (
  pack_id  uuid not null references public.products (id) on delete cascade,
  item_id  uuid not null references public.products (id) on delete restrict,
  qty      int not null default 1 check (qty between 1 and 20),
  primary key (pack_id, item_id),
  check (pack_id <> item_id)
);

alter table public.products enable row level security;
alter table public.product_items enable row level security;
revoke insert, update, delete on public.products, public.product_items from anon;

drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select to anon, authenticated
  using ((active and price_usd is not null) or public.is_admin());
drop policy if exists products_admin_write on public.products;
create policy products_admin_write on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists product_items_read on public.product_items;
create policy product_items_read on public.product_items
  for select to anon, authenticated using (true);
drop policy if exists product_items_admin_write on public.product_items;
create policy product_items_admin_write on public.product_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.products (slug, name, description, kind, price_usd, active, sort) values
  ('mentoria-mensual', 'Mentoría 1:1 mensual', 'Un mes de Frequency Lab: sesiones 1:1, seguimiento y tu espacio de alumno.', 'plan', 60, true, 10),
  ('sesion-aislada', 'Sesión individual', 'Una sesión 1:1 para destrabar un track o una duda puntual.', 'service', null, false, 20),
  ('sesion-mezcla', 'Sesión de mezcla 1:1', 'Mezclamos juntos tu track, en vivo, con criterio y explicación.', 'service', null, false, 30),
  ('mastering-track', 'Mastering por track', 'Master de un track listo para plataformas y club.', 'service', null, false, 40)
on conflict (slug) do nothing;

-- ── Órdenes ───────────────────────────────────────────────
create table if not exists public.orders (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references public.products (id),
  product_name      text not null,                 -- foto del nombre al comprar
  kind              text not null check (kind in ('service', 'plan', 'pack')),
  student_id        uuid references public.students (id) on delete set null,
  buyer_name        text not null check (char_length(buyer_name) between 2 and 120),
  buyer_email       text not null check (buyer_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(buyer_email) <= 200),
  source            text not null check (source in ('shop', 'admin_link')),
  price_usd         numeric(10, 2) not null check (price_usd > 0),   -- precio PROPIO de la orden
  fx_mep            numeric(12, 4) not null check (fx_mep > 0),      -- cotización fijada al crear
  amount_ars        numeric(14, 2) not null check (amount_ars > 0),
  status            text not null default 'pending'
                    check (status in ('pending', 'paid', 'rejected', 'cancelled', 'expired', 'refunded')),
  mp_preference_id  text,
  mp_payment_id     text unique,
  init_point        text,
  note              text check (char_length(note) <= 500),
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '3 days',
  paid_at           timestamptz,
  fulfilled_at      timestamptz
);
create index if not exists orders_status_idx on public.orders (status, created_at desc);

alter table public.orders enable row level security;
revoke all on public.orders from anon;
revoke insert, update, delete on public.orders from authenticated;  -- solo el servidor escribe

drop policy if exists orders_read on public.orders;
create policy orders_read on public.orders
  for select to authenticated
  using (public.is_admin() or student_id = public.current_student_id());

-- Idempotencia del webhook: cada notificación de pago se procesa una sola vez
create table if not exists public.payment_events (
  id           text primary key,              -- mp payment id + estado
  order_id     uuid references public.orders (id) on delete set null,
  payload      jsonb not null,
  received_at  timestamptz not null default now()
);
alter table public.payment_events enable row level security;
revoke all on public.payment_events from anon, authenticated;

-- Marca la orden como pagada y cumple lo que corresponde, en UNA transacción.
-- Plan (mentoría) → activa/extiende 30 días. Servicio/pack → queda para coordinar.
create or replace function public.fulfill_paid_order(p_order_id uuid, p_payment_id text)
returns json
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
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then return json_build_object('result', 'not_found'); end if;
  if o.status = 'paid' then return json_build_object('result', 'already_paid'); end if;

  update public.orders
     set status = 'paid', mp_payment_id = p_payment_id, paid_at = now()
   where id = o.id;

  if o.kind = 'plan' then
    sid := coalesce(o.student_id, (select id from public.students where email = lower(o.buyer_email) limit 1));
    if sid is null then
      return json_build_object('result', 'paid', 'plan', 'no_student');
    end if;
    select case when m.status = 'active' and m.current_period_end > now() then m.current_period_end else now() end
      into base from public.memberships m where m.student_id = sid;
    new_end := coalesce(base, now()) + interval '30 days';
    insert into public.memberships (student_id, status, current_period_end)
    values (sid, 'active', new_end)
    on conflict (student_id) do update set status = 'active', current_period_end = excluded.current_period_end;
    update public.orders set student_id = sid, fulfilled_at = now() where id = o.id;
    return json_build_object('result', 'paid', 'plan', 'activated', 'until', new_end);
  end if;

  return json_build_object('result', 'paid', 'plan', null);
end;
$$;
revoke all on function public.fulfill_paid_order(uuid, text) from public, anon, authenticated;
grant execute on function public.fulfill_paid_order(uuid, text) to service_role;

-- Órdenes vencidas sin pagar: se marcan solas (limpieza diaria)
select cron.unschedule(jobid) from cron.job where jobname = 'orders-expire-daily';
select cron.schedule('orders-expire-daily', '15 4 * * *',
  $$ update public.orders set status = 'expired' where status = 'pending' and expires_at < now() $$);
