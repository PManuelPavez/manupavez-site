-- Calendario de booking + seguimiento de aplicaciones al Lab + lista de fans
--
-- · booking_busy: días ocupados que Manu carga a mano (Table Editor). La web solo ve las fechas
--   vía public_busy_days() — nunca las notas.
-- · lab_leads: ahora se guardan las aplicaciones de /aplicar y /clinicas (Edge Function lab-apply)
--   y un cron diario manda UN mail de seguimiento a los 3 días si no compró nada (lab-followup).
-- · fans: lista de fans con consentimiento explícito (entradas, lista de espera, web).
--   Cada fan tiene un token para darse de baja (fan_unsubscribe, sin login).

-- 1. Días ocupados -------------------------------------------------------------

create table public.booking_busy (
  day date primary key,
  note text,                                  -- privado: solo para Manu
  created_at timestamptz not null default now()
);
alter table public.booking_busy enable row level security;
revoke all on public.booking_busy from anon, authenticated;
create policy booking_busy_admin on public.booking_busy
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.booking_busy to authenticated;

create or replace function public.public_busy_days(p_from date, p_to date)
returns setof date
language sql
stable
security definer
set search_path = ''
as $$
  select b.day from public.booking_busy b
  where b.day between greatest(p_from, current_date) and least(p_to, current_date + 400)
  order by b.day;
$$;
revoke all on function public.public_busy_days(date, date) from public;
grant execute on function public.public_busy_days(date, date) to anon, authenticated;

-- 2. Aplicaciones al Lab + seguimiento ------------------------------------------

alter table public.lab_leads
  add column if not exists source text,
  add column if not exists followup_sent_at timestamptz,
  add column if not exists followup_error text;
create index if not exists lab_leads_followup_idx on public.lab_leads (created_at) where followup_sent_at is null;
create index if not exists lab_leads_email_idx on public.lab_leads (lower(email), created_at);

-- Todos los días 13:07 (ART) = 16:07 UTC, solo si hay alguien para seguir
select cron.unschedule(jobid) from cron.job where jobname = 'lab-followup-daily';
select cron.schedule(
  'lab-followup-daily',
  '7 16 * * *',
  $$
  select net.http_post(
    url := 'https://psnprhzowknhfylvgcci.supabase.co/functions/v1/lab-followup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lab_notify_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from public.lab_leads
    where followup_sent_at is null
      and created_at < now() - interval '3 days'
      and created_at > now() - interval '7 days'
  );
  $$
);

-- 3. Lista de fans ---------------------------------------------------------------

create table public.fans (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text,
  phone text,
  city text,
  source text not null check (source in ('tickets', 'waitlist', 'web')),
  event_slug text,
  consent_at timestamptz not null default now(),
  unsubscribed_at timestamptz,
  unsub_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index fans_token_idx on public.fans (unsub_token);
alter table public.fans enable row level security;
revoke all on public.fans from anon, authenticated;
create policy fans_admin_read on public.fans for select to authenticated using (public.is_admin());
grant select on public.fans to authenticated;

-- Alta/actualización (solo Edge Functions con service_role). Si se había dado de baja y
-- vuelve a marcar la casilla, se reactiva.
create or replace function public.fan_upsert(
  p_email text, p_name text, p_phone text, p_city text, p_source text, p_event_slug text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.fans (email, name, phone, city, source, event_slug)
  values (lower(trim(p_email)), nullif(trim(p_name), ''), nullif(trim(p_phone), ''), nullif(trim(p_city), ''), p_source, p_event_slug)
  on conflict (email) do update set
    name = coalesce(excluded.name, public.fans.name),
    phone = coalesce(excluded.phone, public.fans.phone),
    city = coalesce(excluded.city, public.fans.city),
    consent_at = now(),
    unsubscribed_at = null,
    updated_at = now();
$$;
revoke all on function public.fan_upsert(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.fan_upsert(text, text, text, text, text, text) to service_role;

-- Baja con el link del mail (anónimo, solo con el token)
create or replace function public.fan_unsubscribe(p_token uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with u as (
    update public.fans set unsubscribed_at = coalesce(unsubscribed_at, now()), updated_at = now()
    where unsub_token = p_token
    returning 1
  )
  select exists (select 1 from u);
$$;
revoke all on function public.fan_unsubscribe(uuid) from public;
grant execute on function public.fan_unsubscribe(uuid) to anon, authenticated;
