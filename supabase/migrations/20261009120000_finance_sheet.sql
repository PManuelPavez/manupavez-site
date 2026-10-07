-- ============================================================
-- FREQUENCY LAB — Pagos → planilla de finanzas (Google Sheets)
-- Cada orden pagada (MercadoPago o a mano) se manda como una fila a la
-- pestaña "FREQUENCY LAB" de la planilla de Manu, vía un Web App de Apps Script.
--  · orders.mp_fee_ars / mp_net_ars: comisión de MP y lo que queda limpio
--    (los completa la Edge Function finance-sheet consultando el pago en MP).
--  · orders.sheet_synced_at: ya está en la planilla. Si Google falla, queda
--    en null y el cron lo reintenta cada 5 min.
-- La Edge Function usa el mismo secreto de Vault que lab-notify.
-- ============================================================

alter table public.orders
  add column if not exists mp_fee_ars numeric(14, 2) check (mp_fee_ars >= 0),
  add column if not exists mp_net_ars numeric(14, 2),
  add column if not exists sheet_synced_at timestamptz;

create index if not exists orders_sheet_pending_idx
  on public.orders (paid_at) where status = 'paid' and sheet_synced_at is null;

-- El pago de prueba de USD 1 (MercadoPago, 24/09) no es un ingreso real
update public.orders set sheet_synced_at = now()
 where mp_payment_id = '180618207836' and sheet_synced_at is null;

select cron.unschedule(jobid) from cron.job where jobname = 'finance-sheet-5min';
select cron.schedule(
  'finance-sheet-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://psnprhzowknhfylvgcci.supabase.co/functions/v1/finance-sheet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lab_notify_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  )
  where exists (
    select 1 from public.orders
    where status = 'paid' and sheet_synced_at is null
  );
  $$
);
