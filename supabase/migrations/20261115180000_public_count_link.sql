-- Link sin PIN con el conteo de gente (/conteo.html?k=...), para marketing.
-- · Cada evento tiene una clave secreta larga (count_key). Sin la clave no se ve nada.
-- · public_count(p_key) devuelve solo: nombre/fecha del evento y cuántos entraron
--   (mismo "Adentro" del panel: attendees con checked_in_at), separado en con entrada / invitados.
--   Sin plata, sin nombres, sin datos personales.
-- · admin_count_link(p_slug, p_rotate) le da a Manu la clave; con p_rotate = true la cambia
--   (el link viejo deja de andar).
-- El registro completo de la puerta (door_log) no se toca.

alter table public.events add column if not exists count_key text unique;

create or replace function public.public_count(p_key text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev record;
begin
  if p_key is null or length(p_key) < 32 then return json_build_object('error', 'not_found'); end if;
  select id, name, event_date, venue into v_ev from public.events where count_key = p_key;
  if v_ev.id is null then return json_build_object('error', 'not_found'); end if;
  return (
    select json_build_object(
      'event', json_build_object('name', v_ev.name, 'date', v_ev.event_date, 'venue', v_ev.venue),
      'total', count(*),
      'guests', count(*) filter (where o.method = 'invitado'))
    from public.attendees a join public.ticket_orders o on o.id = a.order_id
    where o.event_id = v_ev.id and o.status = 'approved' and a.checked_in_at is not null
  );
end;
$$;

revoke all on function public.public_count(text) from public;
grant execute on function public.public_count(text) to anon, authenticated;

create or replace function public.admin_count_link(p_slug text, p_rotate boolean default false)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_key text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id, count_key into v_ev, v_key from public.events where slug = p_slug;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  if v_key is null or p_rotate then
    v_key := encode(extensions.gen_random_bytes(24), 'hex');
    update public.events set count_key = v_key where id = v_ev;
  end if;
  return json_build_object('key', v_key);
end;
$$;

revoke all on function public.admin_count_link(text, boolean) from public, anon;
grant execute on function public.admin_count_link(text, boolean) to authenticated;
