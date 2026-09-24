-- ============================================================
-- FREQUENCY LAB — Tracks del alumno ("Work in progress")
-- Primera tabla donde el alumno ESCRIBE. Todo se valida en la base:
-- · solo sus propios tracks, y solo con acceso vigente
-- · solo links https, largos acotados
-- · tope de 30 tracks por alumno y 10 cargas por hora
-- · sin UPDATE: se agrega o se borra (simple y auditable)
-- ============================================================

create table if not exists public.student_tracks (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null default public.current_student_id()
              references public.students (id) on delete cascade,
  title       text not null check (char_length(btrim(title)) between 1 and 120),
  url         text not null check (char_length(url) <= 500 and url ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/\S*)?$'),
  created_at  timestamptz not null default now()
);
create index if not exists student_tracks_student_idx on public.student_tracks (student_id, created_at desc);

alter table public.student_tracks enable row level security;
revoke all on public.student_tracks from anon;
revoke update on public.student_tracks from authenticated;

drop policy if exists tracks_select on public.student_tracks;
create policy tracks_select on public.student_tracks
  for select to authenticated
  using (public.is_admin() or (student_id = public.current_student_id() and public.has_lab_access()));

drop policy if exists tracks_insert on public.student_tracks;
create policy tracks_insert on public.student_tracks
  for insert to authenticated
  with check (student_id = public.current_student_id() and public.has_lab_access());

drop policy if exists tracks_delete on public.student_tracks;
create policy tracks_delete on public.student_tracks
  for delete to authenticated
  using (public.is_admin() or (student_id = public.current_student_id() and public.has_lab_access()));

-- Topes (en la base: no se pueden saltear desde el navegador)
create or replace function public.student_tracks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.title := btrim(new.title);
  new.url := btrim(new.url);
  new.created_at := now();
  if (select count(*) from public.student_tracks where student_id = new.student_id) >= 30 then
    raise exception 'track_limit' using errcode = 'P0001';
  end if;
  if (select count(*) from public.student_tracks
      where student_id = new.student_id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'track_rate' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.student_tracks_guard() from public, anon, authenticated;

drop trigger if exists student_tracks_guard on public.student_tracks;
create trigger student_tracks_guard
  before insert on public.student_tracks
  for each row execute function public.student_tracks_guard();
