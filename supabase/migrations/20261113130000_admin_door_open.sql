-- Manu entra a /puerta con su PIN de admin (13/11).
--
-- El PIN se valida en pin-login (Turnstile + límite de intentos), que devuelve una sesión de Supabase.
-- Con esa sesión, /puerta llama a admin_door_open: si es admin, abre una sesión de puerta normal
-- (16 h) a nombre de "Manu (admin)". Los ingresos quedan registrados con ese nombre.
-- El código interno de "Manu (admin)" es aleatorio y nadie lo conoce: no sirve para door_login.
-- Aparece en el panel junto a los demás códigos, y se puede cerrar como cualquier sesión.

create or replace function public.admin_door_open(p_slug text)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ev uuid;
  v_name text;
  v_code uuid;
  v_token text;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  select id, name into v_ev, v_name from public.events where slug = p_slug and active;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;

  select id into v_code from public.door_codes
  where event_id = v_ev and role = 'door' and label = 'Manu (admin)'
  order by created_at limit 1;
  if v_code is null then
    insert into public.door_codes (event_id, label, code_hash, role, active)
    values (v_ev, 'Manu (admin)', public._hmac('door-admin:' || encode(extensions.gen_random_bytes(32), 'hex')), 'door', true)
    returning id into v_code;
  else
    update public.door_codes set active = true where id = v_code and not active;
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.door_sessions (token_hash, code_id, event_id, expires_at, device, last_seen_at)
  values (public._hmac('door-token:' || v_token), v_code, v_ev, now() + interval '16 hours', public._req_device(), now());
  return json_build_object('token', v_token, 'label', 'Manu (admin)', 'event', v_name);
end;
$$;
revoke all on function public.admin_door_open(text) from public, anon;
grant execute on function public.admin_door_open(text) to authenticated;
