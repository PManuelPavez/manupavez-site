-- ============================================================
-- FREQUENCY LAB — Acceso por PIN (6 dígitos)
-- · El PIN nunca se guarda en claro: HMAC-SHA256 con una clave (pepper)
--   que vive solo en Vault. Ni el admin puede volver a leerlo.
-- · Tabla aparte (access_pins) sin políticas: invisible para la API.
-- · Límite de intentos en la base (no se puede saltear desde el navegador):
--     - 5 fallos seguidos por IP → bloqueo de 15 minutos
--     - 20 fallos por hora en total (todas las IPs) → PIN pausado 1 hora
--       (el login por email sigue funcionando como respaldo)
-- ============================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'pin_pepper') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'pin_pepper',
      'Clave HMAC para PINs de acceso y hashes de IP');
  end if;
end $$;

create table if not exists public.access_pins (
  id             uuid primary key default gen_random_uuid(),
  pin_hash       text not null unique,
  student_id     uuid unique references public.students (id) on delete cascade,
  admin_user_id  uuid unique references auth.users (id) on delete cascade,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint access_pins_one_owner check ((student_id is null) <> (admin_user_id is null))
);

create table if not exists public.pin_attempts (
  id          bigint generated always as identity primary key,
  ip_hash     text not null,
  ok          boolean not null,
  created_at  timestamptz not null default now()
);
create index if not exists pin_attempts_ip_idx on public.pin_attempts (ip_hash, created_at desc);
create index if not exists pin_attempts_fail_idx on public.pin_attempts (created_at) where not ok;

alter table public.access_pins  enable row level security;
alter table public.pin_attempts enable row level security;
revoke all on public.access_pins, public.pin_attempts from anon, authenticated;

-- HMAC con la clave de Vault
create or replace function public._hmac(p_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.hmac(
    p_value,
    (select decrypted_secret from vault.decrypted_secrets where name = 'pin_pepper'),
    'sha256'), 'hex');
$$;

-- PINs obvios que no se aceptan (000000, 111111…, 123456, 654321…)
create or replace function public._pin_is_weak(p_pin text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_pin ~ '^(\d)\1{5}$'
      or position(p_pin in '01234567890') > 0
      or position(p_pin in '09876543210') > 0;
$$;

-- ── Admin: asignar / quitar PIN ─────────────────────────
create or replace function public.admin_set_student_pin(p_student_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_pin !~ '^\d{6}$' then raise exception 'pin_format' using errcode = '22023'; end if;
  if public._pin_is_weak(p_pin) then raise exception 'pin_weak' using errcode = '22023'; end if;
  if not exists (select 1 from public.students where id = p_student_id and email is not null) then
    raise exception 'student_needs_email' using errcode = '22023';
  end if;
  begin
    insert into public.access_pins (pin_hash, student_id) values (public._hmac(p_pin), p_student_id)
    on conflict (student_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  exception when unique_violation then
    raise exception 'pin_in_use' using errcode = '23505';
  end;
end;
$$;

create or replace function public.admin_clear_student_pin(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.access_pins where student_id = p_student_id;
end;
$$;

create or replace function public.admin_set_my_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_pin !~ '^\d{6}$' then raise exception 'pin_format' using errcode = '22023'; end if;
  if public._pin_is_weak(p_pin) then raise exception 'pin_weak' using errcode = '22023'; end if;
  begin
    insert into public.access_pins (pin_hash, admin_user_id) values (public._hmac(p_pin), (select auth.uid()))
    on conflict (admin_user_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
  exception when unique_violation then
    raise exception 'pin_in_use' using errcode = '23505';
  end;
end;
$$;

-- Resumen para el panel (sin exponer hashes)
create or replace function public.admin_pin_overview()
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return json_build_object(
    'students_with_pin', coalesce((select json_agg(student_id) from public.access_pins where student_id is not null), '[]'::json),
    'admin_pin', exists (select 1 from public.access_pins where admin_user_id = (select auth.uid())),
    'failures_1h', (select count(*) from public.pin_attempts where not ok and created_at > now() - interval '1 hour'),
    'global_locked', (select count(*) >= 20 from public.pin_attempts where not ok and created_at > now() - interval '1 hour')
  );
end;
$$;

-- ── Login: SOLO la Edge Function (service_role) llama a esto ──
create or replace function public.pin_login_attempt(p_ip text, p_pin text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip        text := public._hmac('ip:' || coalesce(p_ip, 'unknown'));
  v_last_ok   timestamptz;
  v_fail_ip   int;
  v_fail_all  int;
  v_pin_student uuid;
  v_pin_admin   uuid;
  v_email     text;
  v_admin     boolean := false;
begin
  -- Serializa los intentos: nadie puede ganarle al contador con pedidos en paralelo
  perform pg_advisory_xact_lock(hashtext('pin_login_attempt'));

  delete from public.pin_attempts where created_at < now() - interval '2 days';

  select count(*) into v_fail_all from public.pin_attempts
  where not ok and created_at > now() - interval '1 hour';
  if v_fail_all >= 20 then
    return json_build_object('result', 'locked', 'scope', 'global', 'retry_after', 3600);
  end if;

  select max(created_at) into v_last_ok from public.pin_attempts where ip_hash = v_ip and ok;
  select count(*) into v_fail_ip from public.pin_attempts
  where ip_hash = v_ip and not ok
    and created_at > greatest(now() - interval '15 minutes', coalesce(v_last_ok, '-infinity'::timestamptz));
  if v_fail_ip >= 5 then
    return json_build_object('result', 'locked', 'scope', 'ip', 'retry_after', 900);
  end if;

  if p_pin ~ '^\d{6}$' then
    select student_id, admin_user_id into v_pin_student, v_pin_admin
    from public.access_pins where pin_hash = public._hmac(p_pin);
  end if;

  if v_pin_admin is not null then
    select u.email into v_email from auth.users u where u.id = v_pin_admin;
    v_admin := true;
  elsif v_pin_student is not null then
    select s.email into v_email from public.students s
    where s.id = v_pin_student and s.status = 'active';
    v_admin := exists (
      select 1 from auth.users u join public.profiles p on p.user_id = u.id
      where lower(u.email) = v_email and p.is_admin
    );
  end if;

  if v_email is null then
    insert into public.pin_attempts (ip_hash, ok) values (v_ip, false);
    return json_build_object('result', 'invalid', 'remaining', greatest(0, 4 - v_fail_ip));
  end if;

  insert into public.pin_attempts (ip_hash, ok) values (v_ip, true);
  return json_build_object('result', 'ok', 'email', v_email, 'is_admin', v_admin);
end;
$$;

revoke all on function
  public._hmac(text), public._pin_is_weak(text), public.pin_login_attempt(text, text)
from public, anon, authenticated;
grant execute on function public.pin_login_attempt(text, text) to service_role;

revoke all on function
  public.admin_set_student_pin(uuid, text), public.admin_clear_student_pin(uuid),
  public.admin_set_my_pin(text), public.admin_pin_overview()
from public, anon;
grant execute on function
  public.admin_set_student_pin(uuid, text), public.admin_clear_student_pin(uuid),
  public.admin_set_my_pin(text), public.admin_pin_overview()
to authenticated;
