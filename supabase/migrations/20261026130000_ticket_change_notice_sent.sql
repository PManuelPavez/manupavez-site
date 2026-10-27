-- Marca a qué pedidos ya se les mandó el aviso de cambio de fecha (para no repetirlo).
alter table public.ticket_orders add column if not exists change_notice_sent_at timestamptz;
