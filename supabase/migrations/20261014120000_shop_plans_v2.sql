-- ============================================================
-- FREQUENCY LAB — Planes mensuales v2 + precios a la carta (2026-10-14)
-- · products.features: lista de lo que incluye ([{ "text": "...", "highlight": bool }]).
--   El ítem con highlight se muestra destacado en la tarjeta del shop.
-- · products.fine_print: aclaración visible debajo de la lista.
-- · products.volume_min_qty / volume_price_usd: precio por unidad más bajo
--   desde cierta cantidad en la misma compra (lo aplica mp-checkout).
-- · Los slugs no cambian: mentoria-mensual = Plan "Seguir produciendo",
--   ep-listo-para-enviar = Plan "Lanzar" (los links directos siguen andando).
-- ============================================================

alter table public.products
  add column if not exists features jsonb not null default '[]'::jsonb,
  add column if not exists fine_print text,
  add column if not exists volume_min_qty int,
  add column if not exists volume_price_usd numeric(10, 2);

alter table public.products drop constraint if exists products_features_array;
alter table public.products add constraint products_features_array
  check (jsonb_typeof(features) = 'array');

alter table public.products drop constraint if exists products_volume_check;
alter table public.products add constraint products_volume_check
  check (
    (volume_min_qty is null and volume_price_usd is null)
    or (volume_min_qty between 2 and 20 and volume_price_usd > 0)
  );

-- Plan "Seguir produciendo" — USD 60/mes
update public.products set
  name = 'Plan Seguir produciendo',
  description = 'Un mes dentro del laboratorio para seguir avanzando con tus temas, a tu ritmo.',
  features = '[
    {"text": "4 sesiones 1:1 sobre tus temas", "highlight": false},
    {"text": "1 sesión mensual para definir objetivos", "highlight": false},
    {"text": "Premaster de 1 tema por mes: tu tema mezclado y listo para masterizar", "highlight": false}
  ]'::jsonb,
  fine_print = 'El master se compra aparte. El premaster no es acumulable: si un mes no se usa, no pasa al mes siguiente.',
  price_usd = 60, unit = 'mes', max_qty = 1, kind = 'plan', category = 'mentorias', sort = 10,
  updated_at = now()
where slug = 'mentoria-mensual';

-- Plan "Lanzar" — USD 90/mes (antes "Mentoría 1:1 - Tu primer EP": mismo slug y mismo id)
update public.products set
  name = 'Plan Lanzar',
  description = 'Un mes para terminar tus tracks y llevarlos a sellos con una estrategia clara.',
  features = '[
    {"text": "Estrategia y seguimiento de envío a sellos", "highlight": true},
    {"text": "4 sesiones 1:1 sobre tus temas", "highlight": false},
    {"text": "1 sesión mensual para definir objetivos", "highlight": false},
    {"text": "Mezcla y master de hasta 2 tracks por mes", "highlight": false}
  ]'::jsonb,
  fine_print = 'Mezcla y master de hasta 2 tracks por mes, no acumulables. Tracks adicionales se cobran a precio de servicios a la carta.',
  price_usd = 90, unit = 'mes', max_qty = 1, kind = 'plan', category = 'mentorias', sort = 15,
  updated_at = now()
where slug = 'ep-listo-para-enviar';

-- A la carta
update public.products set price_usd = 15, updated_at = now() where slug = 'sesion-aislada';
update public.products set price_usd = 17, active = true, updated_at = now() where slug = 'sesion-mezcla';
update public.products set price_usd = 8, volume_min_qty = 3, volume_price_usd = 5, updated_at = now()
where slug = 'mastering-track';
