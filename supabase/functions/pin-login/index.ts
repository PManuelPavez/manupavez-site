// supabase/functions/pin-login/index.ts
// Login con PIN de 6 dígitos para alumnos del Lab (y el admin).
//
// Seguridad:
// - La validación y el límite de intentos viven en la base (pin_login_attempt):
//   5 fallos por IP → 15 min de bloqueo; 20 fallos/hora en total → PIN pausado.
// - El PIN nunca viaja a ningún otro lado ni se guarda en claro (HMAC en Vault).
// - Si es válido, se crea la sesión de Supabase del lado del servidor
//   (generateLink + verifyOtp) sin mandar mails, y se devuelven los tokens.
// - Todas las respuestas tardan lo mismo aprox. (no filtra por timing).
// - Cloudflare Turnstile: si existe el secreto TURNSTILE_SECRET_KEY, cada intento
//   tiene que traer un token válido (frena bots antes de tocar el contador de PIN).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ALLOWED = [/^https:\/\/(www\.)?manupavez\.com$/, /^http:\/\/localhost:\d+$/];
const MIN_RESPONSE_MS = 700;
const TURNSTILE_HOSTS = new Set(["manupavez.com", "www.manupavez.com", "localhost"]);

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return true; // todavía sin configurar: no bloquea
  if (!token || token.length > 2048) return false;
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip !== "unknown") form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    const out = await res.json();
    return out.success === true && (!out.hostname || TURNSTILE_HOSTS.has(out.hostname));
  } catch {
    return false;
  }
}

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED.some((re) => re.test(origin)) ? origin : "https://manupavez.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });

  const started = Date.now();
  const reply = async (body: unknown, status = 200) => {
    const wait = MIN_RESPONSE_MS - (Date.now() - started) + Math.random() * 200;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  };

  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);

  let pin = "";
  let captcha = "";
  try {
    const body = await req.json();
    pin = String(body?.pin ?? "");
    captcha = String(body?.captcha ?? "");
  } catch { /* body inválido */ }
  if (!/^\d{6}$/.test(pin)) return reply({ error: "invalid_format" }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ip =
    req.headers.get("cf-connecting-ip") ||
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    "unknown";

  // El captcha se valida ANTES del PIN: un bot sin token ni siquiera cuenta como intento
  if (!(await verifyTurnstile(captcha, ip))) return reply({ error: "captcha" }, 403);

  const { data: r, error } = await admin.rpc("pin_login_attempt", { p_ip: ip, p_pin: pin });
  if (error || !r) {
    console.error("[pin-login] rpc", error?.message);
    return reply({ error: "unavailable" }, 503);
  }
  if (r.result === "locked") return reply({ error: "locked", scope: r.scope, retry_after: r.retry_after }, 429);
  if (r.result !== "ok") return reply({ error: "invalid", remaining: r.remaining }, 401);

  try {
    // La cuenta se crea la primera vez (el portero de auth la acepta: el email es de un alumno)
    let link = await admin.auth.admin.generateLink({ type: "magiclink", email: r.email });
    if (link.error) {
      const created = await admin.auth.admin.createUser({ email: r.email, email_confirm: true });
      if (created.error) throw created.error;
      link = await admin.auth.admin.generateLink({ type: "magiclink", email: r.email });
      if (link.error) throw link.error;
    }

    const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Cuenta nueva → Supabase genera un link de alta ("signup"); existente → "magiclink"
    const { data: v, error: vErr } = await anon.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: (link.data.properties.verification_type || "magiclink") as "magiclink" | "signup",
    });
    if (vErr || !v.session) throw vErr || new Error("no_session");

    return reply({
      access_token: v.session.access_token,
      refresh_token: v.session.refresh_token,
      redirect: r.is_admin ? "admin.html" : "alumnos.html",
    });
  } catch (err) {
    console.error("[pin-login] session", (err as Error).message);
    return reply({ error: "unavailable" }, 503);
  }
});
