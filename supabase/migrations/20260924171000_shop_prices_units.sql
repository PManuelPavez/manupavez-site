-- Precios confirmados por Manu (2026-09-24) + unidad y cantidad (mastering es por track)
alter table public.products add column if not exists unit text not null default 'sesión'
  check (unit in ('sesión', 'track', 'mes'));
alter table public.products add column if not exists max_qty int not null default 1
  check (max_qty between 1 and 20);
alter table public.orders add column if not exists quantity int not null default 1
  check (quantity between 1 and 20);

update public.products set price_usd = 60, unit = 'mes',    max_qty = 1,  active = true where slug = 'mentoria-mensual';
update public.products set price_usd = 15, unit = 'sesión', max_qty = 1,  active = true where slug = 'sesion-aislada';
update public.products set price_usd = 20, unit = 'sesión', max_qty = 1,  active = true where slug = 'sesion-mezcla';
update public.products set price_usd = 8,  unit = 'track',  max_qty = 20, active = true,
  description = 'Master de tus tracks listos para plataformas y club. Elegí cuántos.' where slug = 'mastering-track';

-- Premaster profesional: USD 15 por track (2026-09-24)
insert into public.products (slug, name, description, kind, price_usd, unit, max_qty, active, sort)
values ('premaster-profesional', 'Premaster profesional', 'Tu track preparado para mastering: balance, headroom y limpieza profesional.', 'service', 15, 'track', 20, true, 45)
on conflict (slug) do update set price_usd = excluded.price_usd, unit = excluded.unit, max_qty = excluded.max_qty, active = true;

-- Fix: la regla de lectura llamaba a is_admin(), que anon no puede ejecutar → el shop
-- público fallaba para visitantes. Regla separada para anon (sin is_admin).
drop policy if exists products_public_read on public.products;
create policy products_anon_read on public.products
  for select to anon
  using (active and price_usd is not null);
create policy products_auth_read on public.products
  for select to authenticated
  using ((active and price_usd is not null) or public.is_admin());
