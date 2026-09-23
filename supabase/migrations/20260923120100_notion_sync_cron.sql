-- Sync Notion → base cada hora (minuto 7). El secreto viaja desde Vault; nunca queda en texto plano.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid) from cron.job where jobname = 'notion-sync-hourly';

select cron.schedule(
  'notion-sync-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://psnprhzowknhfylvgcci.supabase.co/functions/v1/notion-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notion_sync_secret')
    ),
    body := '{"trigger":"cron"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
