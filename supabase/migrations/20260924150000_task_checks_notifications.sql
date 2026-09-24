-- ============================================================
-- FREQUENCY LAB — Misiones marcables + avisos por mail al admin
-- · student_task_checks: el alumno marca/desmarca sus misiones (to_do de Notion).
--   Solo claves que existan en SU página (se valida contra student_dashboards).
-- · lab_events: cola de novedades (track subido / misión completada).
--   Un cron cada 5 min junta lo pendiente y la Edge Function lab-notify manda
--   UN mail por alumno. Marcar y desmarcar rápido (o subir y borrar) no avisa.
-- ============================================================

create table if not exists public.student_task_checks (
  student_id  uuid not null default public.current_student_id()
              references public.students (id) on delete cascade,
  task_key    text not null check (task_key ~ '^[0-9a-f-]{32,36}$'),
  done        boolean not null,
  updated_at  timestamptz not null default now(),
  primary key (student_id, task_key)
);

alter table public.student_task_checks enable row level security;
revoke all on public.student_task_checks from anon;
revoke delete on public.student_task_checks from authenticated;

drop policy if exists task_checks_select on public.student_task_checks;
create policy task_checks_select on public.student_task_checks
  for select to authenticated
  using (public.is_admin() or (student_id = public.current_student_id() and public.has_lab_access()));

drop policy if exists task_checks_insert on public.student_task_checks;
create policy task_checks_insert on public.student_task_checks
  for insert to authenticated
  with check (student_id = public.current_student_id() and public.has_lab_access());

drop policy if exists task_checks_update on public.student_task_checks;
create policy task_checks_update on public.student_task_checks
  for update to authenticated
  using (student_id = public.current_student_id() and public.has_lab_access())
  with check (student_id = public.current_student_id() and public.has_lab_access());

-- La misión tiene que existir en la página del alumno (no se inventan claves)
create or replace function public.student_task_checks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if not exists (
    select 1 from public.student_dashboards d
    where d.student_id = new.student_id
      and jsonb_path_exists(
        d.content,
        '$.rows[*].cols[*][*].items[*] ? (@.t == "task" && @.id == $k)',
        jsonb_build_object('k', new.task_key))
  ) then
    raise exception 'task_not_found' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists student_task_checks_guard on public.student_task_checks;
create trigger student_task_checks_guard
  before insert or update on public.student_task_checks
  for each row execute function public.student_task_checks_guard();

-- ── Cola de novedades ─────────────────────────────────────
create table if not exists public.lab_events (
  id          bigint generated always as identity primary key,
  student_id  uuid not null references public.students (id) on delete cascade,
  kind        text not null check (kind in ('track_added', 'task_done')),
  ref_id      text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists lab_events_pending_idx on public.lab_events (created_at) where sent_at is null;

alter table public.lab_events enable row level security;
revoke all on public.lab_events from anon, authenticated;

create or replace function public.lab_events_from_tracks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lab_events (student_id, kind, ref_id, payload)
    values (new.student_id, 'track_added', new.id::text, jsonb_build_object('title', new.title, 'url', new.url));
    return new;
  end if;
  -- Subió y borró antes del aviso: no se avisa
  delete from public.lab_events
  where kind = 'track_added' and ref_id = old.id::text and sent_at is null;
  return old;
end;
$$;

drop trigger if exists lab_events_from_tracks on public.student_tracks;
create trigger lab_events_from_tracks
  after insert or delete on public.student_tracks
  for each row execute function public.lab_events_from_tracks();

create or replace function public.lab_events_from_checks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    -- Tope anti-spam: máx. 30 avisos de misiones por alumno por hora
    if (select count(*) from public.lab_events
        where student_id = new.student_id and kind = 'task_done'
          and created_at > now() - interval '1 hour') < 30
       and not exists (select 1 from public.lab_events
        where student_id = new.student_id and kind = 'task_done'
          and ref_id = new.task_key and sent_at is null) then
      insert into public.lab_events (student_id, kind, ref_id)
      values (new.student_id, 'task_done', new.task_key);
    end if;
  elsif not new.done then
    -- La desmarcó antes del aviso: no se avisa
    delete from public.lab_events
    where student_id = new.student_id and kind = 'task_done'
      and ref_id = new.task_key and sent_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists lab_events_from_checks on public.student_task_checks;
create trigger lab_events_from_checks
  after insert or update on public.student_task_checks
  for each row execute function public.lab_events_from_checks();

revoke all on function
  public.student_task_checks_guard(), public.lab_events_from_tracks(), public.lab_events_from_checks()
from public, anon, authenticated;

-- ── Secreto del cron → lab-notify (generado en la base, nadie lo ve) ──
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'lab_notify_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'lab_notify_secret',
      'Secreto compartido pg_cron -> Edge Function lab-notify');
  end if;
end $$;

create or replace function public.verify_notify_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(length(p_secret) = 64, false) and exists (
    select 1 from vault.decrypted_secrets
    where name = 'lab_notify_secret' and decrypted_secret = p_secret
  );
$$;
revoke all on function public.verify_notify_secret(text) from public, anon, authenticated;
grant execute on function public.verify_notify_secret(text) to service_role;

-- Cada 5 min, SOLO si hay novedades con más de 2 min (agrupa clics seguidos)
select cron.unschedule(jobid) from cron.job where jobname = 'lab-notify-5min';
select cron.schedule(
  'lab-notify-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://psnprhzowknhfylvgcci.supabase.co/functions/v1/lab-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lab_notify_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from public.lab_events
    where sent_at is null and created_at < now() - interval '2 minutes'
  );
  $$
);
