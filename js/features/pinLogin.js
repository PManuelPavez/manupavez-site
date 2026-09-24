// pinLogin.js — Ingreso con PIN de 6 dígitos (popup de /clinicas y página /alumnos).
// Toda la seguridad está en el servidor (Edge Function pin-login): límite de
// intentos, Turnstile y validación. Acá solo se envía y se guarda la sesión.
import { supabase } from "../data/supabaseClient.js";

export const PIN_MESSAGES = {
  invalid_format: "El código tiene 6 números.",
  unavailable: "No pude verificar tu código. Probá de nuevo en un momento.",
  network: "Sin conexión. Revisá tu internet y probá de nuevo.",
  captcha: "No pudimos verificar que no sos un robot. Esperá un segundo y probá de nuevo.",
  locked_ip: "Demasiados intentos. Esperá 15 minutos y probá de nuevo.",
  locked_global: "El acceso con código está pausado por seguridad. Entrá con tu email.",
};

/** Devuelve { ok: true, redirect } o { ok: false, message } */
export async function loginWithPin(pin, captcha = "") {
  if (!/^\d{6}$/.test(pin)) return { ok: false, message: PIN_MESSAGES.invalid_format };

  let res;
  let body = {};
  try {
    res = await fetch(`${window.MP_SUPABASE.url}/functions/v1/pin-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, captcha }),
    });
    body = await res.json().catch(() => ({}));
  } catch {
    return { ok: false, message: PIN_MESSAGES.network };
  }

  if (res.ok && body.access_token) {
    const { error } = await supabase.auth.setSession({
      access_token: body.access_token,
      refresh_token: body.refresh_token,
    });
    if (error) return { ok: false, message: PIN_MESSAGES.unavailable };
    const redirect = body.redirect === "admin.html" ? "admin.html" : "alumnos.html";
    return { ok: true, redirect };
  }

  if (body.error === "locked") {
    return { ok: false, message: body.scope === "global" ? PIN_MESSAGES.locked_global : PIN_MESSAGES.locked_ip };
  }
  if (body.error === "invalid") {
    const left = Number(body.remaining);
    return {
      ok: false,
      message: left > 0
        ? `Código incorrecto. Te quedan ${left} ${left === 1 ? "intento" : "intentos"}.`
        : "Código incorrecto. Por seguridad, el acceso con código quedó bloqueado 15 minutos.",
    };
  }
  return { ok: false, message: PIN_MESSAGES[body.error] || PIN_MESSAGES.unavailable };
}
