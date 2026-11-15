-- Conteo para mostrar al boliche: personas que la puerta marcó como ingresadas (door_log 'in').
-- No cambia si después se deshace un ingreso desde el panel. Sin montos.
create or replace function public.admin_venue_count(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id into v_ev from public.events where slug = p_slug;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  return (
    select json_build_object(
      'total', count(*),
      'guests', count(*) filter (where o.method = 'invitado'))
    from public.attendees a join public.ticket_orders o on o.id = a.order_id
    where o.event_id = v_ev and o.status = 'approved'
      and exists (select 1 from public.door_log l where l.attendee_id = a.id and l.action = 'in')
  );
end;
$$;

revoke all on function public.admin_venue_count(text) from public, anon;
grant execute on function public.admin_venue_count(text) to authenticated;
