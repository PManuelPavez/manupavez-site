// turnstile.js — Cloudflare Turnstile (anti-bots) para los logins del Lab.
// La clave del sitio es pública: vive en js/supabase-config.js (turnstileSiteKey).
// Si está vacía, no se muestra nada y los logins siguen funcionando.
// La verificación real la hace el servidor (pin-login / Supabase Auth).

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading = null;

export const turnstileSiteKey = () => String(window.MP_SUPABASE?.turnstileSiteKey || "");

function load() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => reject(new Error("turnstile_load_failed"));
    document.head.appendChild(s);
  });
  return loading;
}

/**
 * Monta el widget en `el`. Devuelve { getToken(), reset() }.
 * getToken espera hasta ~8s a que Cloudflare resuelva el desafío (casi siempre invisible).
 */
export async function mountTurnstile(el) {
  const sitekey = turnstileSiteKey();
  if (!sitekey || !el) return { getToken: async () => "", reset() {} };

  let token = "";
  let failed = false; // si Cloudflare da error, no hace falta esperar el token
  let widgetId = null;
  try {
    const ts = await load();
    widgetId = ts.render(el, {
      sitekey,
      theme: "dark",
      size: "flexible",
      callback: (t) => { token = t; failed = false; },
      "expired-callback": () => { token = ""; },
      "error-callback": () => { token = ""; failed = true; },
    });
  } catch {
    // Si Cloudflare no carga, el servidor decide (con el secreto configurado, rechaza)
    failed = true;
  }

  return {
    async getToken() {
      for (let i = 0; i < 40 && !token && !failed; i++) await new Promise((r) => setTimeout(r, 200));
      return token;
    },
    // Cada token sirve una sola vez: después de cada intento se pide uno nuevo
    reset() {
      token = "";
      failed = false;
      if (widgetId !== null) window.turnstile?.reset(widgetId);
    },
  };
}
