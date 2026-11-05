-- FREQUENCY LAB — Nombres nuevos de los planes de mentoría.
-- Solo cambian nombre y bajada; slugs, precios y features quedan igual.
-- Las órdenes viejas no se tocan (orders.product_name queda como se cobró).

update public.products set name = 'Frecuencia',
  description = 'Mentoría 1:1 para terminar tu música con criterio.'
where slug = 'mentoria-mensual';

update public.products set name = 'Resonancia',
  description = 'Mentoría, mezcla y estrategia para llevar tu EP a sellos, ideal para productores comprometidos.'
where slug = 'ep-listo-para-enviar';
