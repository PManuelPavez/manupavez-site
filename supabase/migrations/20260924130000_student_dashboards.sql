-- ============================================================
-- FREQUENCY LAB — Página del alumno (espejo de su página de Notion)
-- · student_dashboards: filas/columnas/secciones de la página del alumno
--   (Diagnóstico, Misiones, Enlaces, …). Mismo control de acceso que sessions:
--   si revocás a un alumno, deja de verla al instante.
-- · link_titles: caché de títulos de bookmarks (la API de Notion no los da;
--   el sync los lee una sola vez de la página enlazada).
-- ============================================================

create table if not exists public.student_dashboards (
  student_id        uuid primary key references public.students (id) on delete cascade,
  content           jsonb not null default '{}'::jsonb,
  notion_synced_at  timestamptz not null default now()
);

alter table public.student_dashboards enable row level security;
revoke all on public.student_dashboards from anon;

drop policy if exists dashboards_select on public.student_dashboards;
create policy dashboards_select on public.student_dashboards
  for select to authenticated
  using (
    public.is_admin()
    or (student_id = public.current_student_id() and public.has_lab_access())
  );

create table if not exists public.link_titles (
  url         text primary key,
  title       text,
  fetched_at  timestamptz not null default now()
);
alter table public.link_titles enable row level security;
revoke all on public.link_titles from anon, authenticated;
