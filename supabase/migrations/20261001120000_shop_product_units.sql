-- Productos nuevos desde el panel admin: se suma la unidad "unidad" (software, packs, etc.).
-- La carga/edición la hace el admin desde admin.html (RLS products_admin_write ya lo permite).
alter table public.products drop constraint if exists products_unit_check;
alter table public.products add constraint products_unit_check
  check (unit in ('sesión', 'track', 'mes', 'unidad'));
