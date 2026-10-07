-- ============================================================
-- FREQUENCY LAB — Shop por secciones + pago por transferencia
-- · products.category: sección del shop (Mentorías / Clínicas / Mix & Master / Otros).
--   La elige el admin en el panel.
-- · Transferencia: mp-checkout crea la orden con payment_method = 'transferencia',
--   sin link de MercadoPago. Manu la marca como pagada desde el panel
--   (mark_order_paid_manual), igual que cualquier pago a mano.
-- ============================================================

alter table public.products
  add column if not exists category text not null default 'otros'
  check (category in ('mentorias', 'clinicas', 'mixmaster', 'otros'));

update public.products set category = 'mentorias' where slug in ('mentoria-mensual', 'ep-listo-para-enviar');
update public.products set category = 'clinicas'  where slug = 'sesion-aislada';
update public.products set category = 'mixmaster' where slug in ('sesion-mezcla', 'mastering-track', 'premaster-profesional');
