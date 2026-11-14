-- Puerta: Manu entra con su PIN de admin SIN verificación anti-robots (14/11, día del evento).
--
-- Antes pasaba por pin-login (Turnstile) y fallaba la verificación. Ahora el PIN se valida acá,
-- igual que los códigos de puerta: cada intento fallido tarda 1 s y queda registrado.
-- Además, 5 fallos desde la misma conexión frenan esa conexión 15 minutos (solo para este acceso),
-- porque el PIN de admin también abre el panel. Seguridad sigue entrando con su código, sin cambios.
-- La sesión que se abre es solo de puerta ("Manu (admin)"), no da acceso al panel.

create or replace function public.door_admin_login(p_pin text, p_slug text default 'pergamino')
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ip text := public._hmac('door-admin-ip:' || public._req_ip());
  v_fails int;
  v_admin uuid;
  v_ev uuid;
  v_name text;
  v_code uuid;
  v_token text;
begin
  select count(*) into v_fails from public.door_attempts
  where ip_hash = v_ip and not ok and created_at > now() - interval '15 minutes';
  if v_fails >= 5 then return json_build_object('error', 'locked'); end if;

  if coalesce(p_pin, '') ~ '^\d{6}$' then
    select ap.admin_user_id into v_admin
    from public.access_pins ap join public.profiles p on p.user_id = ap.admin_user_id and p.is_admin
    where ap.pin_hash = public._hmac(p_pin) and ap.admin_user_id is not null
    limit 1;
  end if;

  if v_admin is null then
    insert into public.door_attempts (ip_hash, ok) values (v_ip, false);
    perform pg_sleep(1);
    return json_build_object('error', 'invalid', 'remaining', greatest(0, 4 - v_fails));
  end if;

  select id, name into v_ev, v_name from public.events where slug = p_slug and active;
  if v_ev is null then return json_build_object('error', 'event_not_found'); end if;
  insert into public.door_attempts (ip_hash, ok) values (v_ip, true);

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
revoke all on function public.door_admin_login(text, text) from public;
grant execute on function public.door_admin_login(text, text) to anon, authenticated;
