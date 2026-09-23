-- ============================================================
-- FREQUENCY LAB — Portal de alumnos (Paso 2)
-- · Cierra huecos de seguridad (registro libre, is_admin, profiles, lab_leads)
-- · Modelo: students / memberships / sessions / sync_runs
-- · Regla de oro: el navegador SOLO lee lo que RLS le permite.
--   Las escrituras de sync van con service_role desde la Edge Function.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Admin: is_admin() blindada + profiles con reglas
-- ────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid()) and p.is_admin = true
  );
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

-- Cada uno ve su propio perfil; el admin ve todos.
-- SIN políticas de insert/update/delete: nadie puede auto-promoverse a admin
-- desde el navegador. Los admins se asignan solo por SQL.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

insert into public.profiles (user_id, is_admin)
select id, true from auth.users where email = 'manupavez22@gmail.com'
on conflict do nothing;

-- ────────────────────────────────────────────────────────────
-- 1. lab_leads: se cierra la inserción pública (spam). Datos intactos.
--    Hoy los leads llegan por FormSubmit; la tabla queda solo lectura admin.
-- ────────────────────────────────────────────────────────────
drop policy if exists "allow insert" on public.lab_leads;
drop policy if exists lab_leads_admin_read on public.lab_leads;
create policy lab_leads_admin_read on public.lab_leads
  for select to authenticated
  using (public.is_admin());

-- ────────────────────────────────────────────────────────────
-- 2. Tablas del portal
-- ────────────────────────────────────────────────────────────
create table if not exists public.students (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users (id) on delete set null,
  email           text unique,
  full_name       text not null,
  notion_page_id  text unique,
  status          text not null default 'active' check (status in ('active', 'inactive')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.students is 'Alumnos del Lab. Uno por página de Notion. email habilita el login.';

create table if not exists public.memberships (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null unique references public.students (id) on delete cascade,
  plan                text not null default 'mentoria_mensual',
  status              text not null default 'revoked' check (status in ('active', 'past_due', 'revoked')),
  current_period_end  timestamptz,           -- null = sin vencimiento (acceso manual)
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.memberships is 'Acceso al área de alumnos. Solo active + vigente da acceso.';

create table if not exists public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  student_id          uuid not null references public.students (id) on delete cascade,
  notion_page_id      text not null unique,
  number              int,
  title               text not null,
  session_date        date,
  notes               text,
  tasks               jsonb not null default '[]'::jsonb,   -- [{ text, done }]
  links               jsonb not null default '[]'::jsonb,   -- [{ url, label }]
  notion_last_edited  timestamptz,
  in_notion           boolean not null default true,        -- false = ya no está en Notion (se oculta)
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now()
);
create index if not exists sessions_student_idx on public.sessions (student_id, number desc);

create table if not exists public.sync_runs (
  id           bigint generated always as identity primary key,
  trigger      text not null default 'cron',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  stats        jsonb,
  error        text
);

alter table public.students    enable row level security;
alter table public.memberships enable row level security;
alter table public.sessions    enable row level security;
alter table public.sync_runs   enable row level security;

-- Nada de esto es para visitantes anónimos
revoke all on public.students, public.memberships, public.sessions, public.sync_runs from anon;

-- ────────────────────────────────────────────────────────────
-- 3. Helpers de acceso (security definer, search_path fijo)
-- ────────────────────────────────────────────────────────────
create or replace function public.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id from public.students s
  where s.user_id = (select auth.uid()) and s.status = 'active'
  limit 1;
$$;

create or replace function public.has_lab_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.students s
    join public.memberships m on m.student_id = s.id
    where s.user_id = (select auth.uid())
      and s.status = 'active'
      and m.status = 'active'
      and (m.current_period_end is null or m.current_period_end > now())
  );
$$;

revoke all on function public.current_student_id(), public.has_lab_access() from public, anon;
grant execute on function public.current_student_id(), public.has_lab_access() to authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 4. Reglas de acceso (RLS)
-- ────────────────────────────────────────────────────────────
-- students: el alumno ve su fila; el admin ve y edita todo.
drop policy if exists students_select on public.students;
create policy students_select on public.students
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());
drop policy if exists students_admin_write on public.students;
create policy students_admin_write on public.students
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- memberships: el alumno ve la suya (para saber si está pausado); solo admin edita.
drop policy if exists memberships_select on public.memberships;
create policy memberships_select on public.memberships
  for select to authenticated
  using (student_id = public.current_student_id() or public.is_admin());
drop policy if exists memberships_admin_write on public.memberships;
create policy memberships_admin_write on public.memberships
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- sessions: el alumno ve SOLO las suyas y SOLO con acceso vigente.
-- Sin políticas de escritura: solo el sync (service_role) escribe.
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (
    public.is_admin()
    or (in_notion and student_id = public.current_student_id() and public.has_lab_access())
  );

-- sync_runs: solo admin
drop policy if exists sync_runs_admin_read on public.sync_runs;
create policy sync_runs_admin_read on public.sync_runs
  for select to authenticated
  using (public.is_admin());

-- material_alumnos: antes bastaba con estar logueado. Ahora exige acceso vigente.
drop policy if exists material_select_authenticated on public.material_alumnos;
drop policy if exists material_select_members on public.material_alumnos;
create policy material_select_members on public.material_alumnos
  for select to authenticated
  using (visible and (public.has_lab_access() or public.is_admin()));

-- ────────────────────────────────────────────────────────────
-- 5. Triggers: email normalizado, vínculo con auth, membership por defecto
-- ────────────────────────────────────────────────────────────
create or replace function public.students_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.email := nullif(lower(trim(new.email)), '');
  new.updated_at := now();
  -- Si cambia el email, se re-vincula con la cuenta que tenga ese email (si existe)
  if tg_op = 'INSERT' or new.email is distinct from old.email then
    new.user_id := (select u.id from auth.users u where lower(u.email) = new.email limit 1);
  end if;
  return new;
end;
$$;
drop trigger if exists students_before_write on public.students;
create trigger students_before_write
  before insert or update on public.students
  for each row execute function public.students_before_write();

create or replace function public.students_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Todo alumno nuevo arranca SIN acceso: lo activás vos (o el pago, en el paso 4).
  insert into public.memberships (student_id) values (new.id)
  on conflict (student_id) do nothing;
  return new;
end;
$$;
drop trigger if exists students_after_insert on public.students;
create trigger students_after_insert
  after insert on public.students
  for each row execute function public.students_after_insert();

create or replace function public.memberships_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists memberships_touch on public.memberships;
create trigger memberships_touch
  before update on public.memberships
  for each row execute function public.memberships_touch();

-- ────────────────────────────────────────────────────────────
-- 6. PORTERO DEL LOGIN: se acabó el registro libre.
--    El magic link solo puede crear cuenta si el email está en students
--    (activo). Se aplica en la base, no en el navegador: no se puede saltear.
-- ────────────────────────────────────────────────────────────
create or replace function public.gate_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.students s
    where s.email = lower(new.email) and s.status = 'active'
  ) then
    raise exception 'signup_not_allowed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists gate_new_auth_user on auth.users;
create trigger gate_new_auth_user
  before insert on auth.users
  for each row execute function public.gate_new_auth_user();

create or replace function public.link_student_on_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.students set user_id = new.id
  where email = lower(new.email) and user_id is null;
  return new;
end;
$$;
drop trigger if exists link_student_on_signup on auth.users;
create trigger link_student_on_signup
  after insert on auth.users
  for each row execute function public.link_student_on_signup();

-- Las funciones de trigger no se llaman desde la API
revoke all on function
  public.students_before_write(), public.students_after_insert(), public.memberships_touch(),
  public.gate_new_auth_user(), public.link_student_on_signup()
from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────
-- 7. Secreto del cron (generado dentro de la base; nadie lo ve ni lo pega)
-- ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notion_sync_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'notion_sync_secret',
      'Secreto compartido pg_cron → Edge Function notion-sync'
    );
  end if;
end $$;

create or replace function public.verify_sync_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) = 64, false) and exists (
    select 1 from vault.decrypted_secrets
    where name = 'notion_sync_secret' and decrypted_secret = p_secret
  );
$$;
revoke all on function public.verify_sync_secret(text) from public, anon, authenticated;
grant execute on function public.verify_sync_secret(text) to service_role;

-- ────────────────────────────────────────────────────────────
-- 8. Precio de catálogo de la mentoría (decisión 2026-09-23)
-- ────────────────────────────────────────────────────────────
update public.planes set precio = '$60 USD', updated_at = now() where titulo = '1:1 Mensual';
