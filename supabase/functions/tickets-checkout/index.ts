// supabase/functions/tickets-checkout/index.ts
// Compra de entradas (página /pergamino) y lista de espera.
//
//  · action "buy"      → reserva el stock 15 min (RPC ticket_reserve, atómica) y crea el link de
//                        MercadoPago Checkout Pro por el total en ARS. Precio = el de la tanda, sin recargos.
//  · action "waitlist" → guarda en waitlist (solo si no hay tanda a la venta).
//  · fans: true         → además suma a la lista de fans (casilla marcada en la página).
//
// Público, con Turnstile. Va aparte de mp-checkout para no tocar el shop del Lab.
// Secretos: MP_ACCESS_TOKEN, TURNSTILE_SECRET_KEY, SITE_URL (opcional).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ALLOWED = [/^https:\/\/(www\.)?manupavez\.com$/, /^http:\/\/localhost:\d+$/];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const NAME_RE = /^[\p{L}\p{M}' .-]{1,60}$/u;
const TTL_MIN = 15;

function cors(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED.some((re) => re.test(origin)) ? origin : "https://manupavez.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

async function verifyTurnstile(token: string, ip: string): Promise<boolean> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) return true;
  if (!token || token.length > 2048) return false;
  try {
    const form = new FormData();
    form.append("secret", secret);
    form.append("response", token);
    if (ip !== "unknown") form.append("remoteip", ip);
    const out = await (await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form })).json();
    return out.success === true;
  } catch {
    return false;
  }
}

// Lista de fans: solo si la persona marcó la casilla. Si falla, la compra sigue igual.
async function addFan(db: any, f: { email: string; name: string; phone: string; source: string; event: string }) {
  const { error } = await db.rpc("fan_upsert", { p_email: f.email, p_name: f.name, p_phone: f.phone, p_city: "", p_source: f.source, p_event_slug: f.event });
  if (error) console.error("[tickets-checkout] fan_upsert", error.message);
}

const clean = (v: unknown, max = 60) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const validName = (s: string) => s.length >= 1 && NAME_RE.test(s);

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const ip = req.headers.get("cf-connecting-ip") || (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

  if (!(await verifyTurnstile(String(body.captcha || ""), ip))) return json({ error: "captcha" }, 403);

  const { data: ev } = await db.from("events").select("id, slug, name").eq("slug", clean(body.event, 60)).eq("active", true).maybeSingle();
  if (!ev) return json({ error: "event_not_found" }, 404);

  const email = clean(body.email, 200).toLowerCase();
  const phone = clean(body.phone, 30).replace(/[^\d+]/g, "");
  if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);
  if (phone.replace(/\D/g, "").length < 8 || phone.length > 20) return json({ error: "invalid_phone" }, 400);

  // ---- Lista de espera ----
  if (body.action === "waitlist") {
    const name = clean(body.name, 120);
    if (name.length < 2) return json({ error: "invalid_name" }, 400);
    const { data: pub } = await db.rpc("public_event", { p_slug: ev.slug });
    if (pub?.current) return json({ error: "on_sale" }, 409);
    const { error } = await db.from("waitlist").upsert({ event_id: ev.id, name, phone, email }, { onConflict: "event_id,email", ignoreDuplicates: true });
    if (error) return json({ error: "waitlist_failed" }, 500);
    if (body.fans === true) await addFan(db, { email, name, phone, source: "waitlist", event: ev.slug });
    return json({ ok: true });
  }

  // ---- Compra ----
  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!token) return json({ error: "payments_not_configured" }, 503);

  const first = clean(body.first_name);
  const last = clean(body.last_name);
  if (!validName(first) || !validName(last)) return json({ error: "invalid_name" }, 400);

  const quantity = Math.floor(Number(body.quantity));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 6) return json({ error: "invalid_quantity" }, 400);

  const raw = Array.isArray(body.attendees) ? body.attendees : [];
  const attendees = raw.slice(0, 6).map((a: Record<string, unknown>) => ({ first_name: clean(a?.first_name), last_name: clean(a?.last_name) }));
  if (attendees.length !== quantity || attendees.some((a) => !validName(a.first_name) || !validName(a.last_name))) {
    return json({ error: "invalid_attendees" }, 400);
  }

  const rrppCode = /^[A-Za-z0-9]{2,20}$/.test(String(body.rrpp || "")) ? String(body.rrpp).toUpperCase() : "";
  const tierId = /^[0-9a-f-]{36}$/i.test(String(body.tier_id || "")) ? String(body.tier_id) : null;

  // Anti-spam: máx. 3 pedidos pendientes por mail en la última hora.
  // Si repite la misma compra con el link vigente, se le devuelve ese mismo link.
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { data: pend } = await db.from("ticket_orders")
    .select("id, quantity, init_point, expires_at, total_ars")
    .eq("buyer_email", email).eq("status", "pending").gt("created_at", since)
    .order("created_at", { ascending: false });
  const reuse = (pend || []).find((p) => p.quantity === quantity && p.init_point && new Date(p.expires_at).getTime() > Date.now() + 60_000);
  if (reuse) return json({ order_id: reuse.id, init_point: reuse.init_point, total_ars: reuse.total_ars, reused: true });
  if ((pend || []).length >= 3) return json({ error: "too_many_orders" }, 429);

  const { data: r, error: rErr } = await db.rpc("ticket_reserve", {
    p_event_id: ev.id, p_tier_id: tierId, p_quantity: quantity,
    p_first_name: first, p_last_name: last, p_phone: phone, p_email: email,
    p_rrpp_code: rrppCode, p_attendees: attendees, p_ttl_minutes: TTL_MIN,
  });
  if (rErr || !r) {
    console.error("[tickets-checkout] reserve", rErr?.message);
    return json({ error: "reserve_failed" }, 500);
  }
  if (r.error) return json(r, 409);
  if (body.fans === true) await addFan(db, { email, name: `${first} ${last}`, phone, source: "tickets", event: ev.slug });

  const site = Deno.env.get("SITE_URL") || "https://manupavez.com";
  const back = (estado: string) => `${site}/pergamino.html?pago=${estado}&orden=${r.order_id}`;
  const title = `${ev.name} — ${r.tier}${quantity > 1 ? ` ×${quantity}` : ""}`;
  const pref = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Idempotency-Key": r.order_id },
    body: JSON.stringify({
      // Un solo ítem por el total: el monto queda exacto y fijo
      items: [{ id: `entrada-${ev.slug}`, title, quantity: 1, unit_price: r.total_ars, currency_id: "ARS" }],
      payer: { email, name: first, surname: last },
      external_reference: `tk_${r.order_id}`,
      metadata: { ticket_order_id: r.order_id },
      notification_url: `${url}/functions/v1/tickets-webhook`,
      back_urls: { success: back("ok"), failure: back("error"), pending: back("pendiente") },
      auto_return: "approved",
      statement_descriptor: "MANU PAVEZ",
      // Sin efectivo (Rapipago/Pago Fácil): se acreditan días después y la reserva dura 15 min
      payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
      expires: true,
      expiration_date_to: r.expires_at,
    }),
  });
  const prefBody = await pref.json().catch(() => ({}));
  if (!pref.ok || !prefBody.init_point) {
    console.error("[tickets-checkout] preference", pref.status, JSON.stringify(prefBody).slice(0, 300));
    await db.rpc("ticket_release", { p_order_id: r.order_id, p_status: "expired" });
    return json({ error: "mp_failed" }, 502);
  }

  await db.from("ticket_orders").update({ mp_preference_id: prefBody.id, init_point: prefBody.init_point }).eq("id", r.order_id);
  return json({ order_id: r.order_id, init_point: prefBody.init_point, total_ars: r.total_ars, tier: r.tier, expires_at: r.expires_at });
});
