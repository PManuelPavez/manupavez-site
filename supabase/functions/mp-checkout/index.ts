// supabase/functions/mp-checkout/index.ts
// Crea una orden y su link de pago de MercadoPago.
//
// Dos caminos:
//  · mode "shop"       → compra pública al precio de catálogo (Turnstile obligatorio si está configurado).
//  · mode "admin_link" → el admin genera un link con PRECIO ESPECIAL para un alumno/servicio
//                        (requiere JWT de admin). El precio público no se toca.
//
// El monto en ARS sale del dólar MEP consultado ACÁ, en el servidor, y queda fijo en la orden.
// Secretos: MP_ACCESS_TOKEN (obligatorio para cobrar), TURNSTILE_SECRET_KEY, SITE_URL (opcional).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ALLOWED = [/^https:\/\/(www\.)?manupavez\.com$/, /^http:\/\/localhost:\d+$/];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

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

// Dólar MEP (venta). Se valida que el número sea razonable antes de usarlo.
async function fetchMep(): Promise<number | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://dolarapi.com/v1/dolares/bolsa", { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const v = Number((await res.json())?.venta);
        if (Number.isFinite(v) && v > 100 && v < 100000) return v;
      }
    } catch { /* reintento */ }
  }
  return null;
}

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

  // ¿Quién pide? (opcional en el shop, obligatorio para el link de admin)
  let userId: string | null = null;
  let isAdmin = false;
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (jwt && jwt.split(".").length === 3) {
    const { data: u } = await db.auth.getUser(jwt);
    if (u?.user) {
      userId = u.user.id;
      const { data: prof } = await db.from("profiles").select("is_admin").eq("user_id", userId).maybeSingle();
      isAdmin = prof?.is_admin === true;
    }
  }

  const mode = body.mode === "admin_link" ? "admin_link" : "shop";
  if (mode === "admin_link" && !isAdmin) return json({ error: "unauthorized" }, 401);
  if (mode === "shop" && !(await verifyTurnstile(String(body.captcha || ""), ip))) return json({ error: "captcha" }, 403);

  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!token) return json({ error: "payments_not_configured" }, 503);

  // Producto
  const productQuery = db.from("products").select("id, slug, name, kind, price_usd, active, unit, max_qty");
  const { data: product } = mode === "admin_link"
    ? await productQuery.eq("id", String(body.product_id || "")).maybeSingle()
    : await productQuery.eq("slug", String(body.product || "")).maybeSingle();
  if (!product) return json({ error: "product_not_found" }, 404);
  if (mode === "shop" && (!product.active || !product.price_usd)) return json({ error: "product_not_available" }, 404);

  // Cantidad (ej. mastering por track): 1..max_qty del producto
  const quantity = Math.floor(Number(body.quantity ?? 1));
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > (product.max_qty || 1)) return json({ error: "invalid_quantity" }, 400);

  // Precio: el del catálogo × cantidad, o el total especial que define el admin (sin tocar el público)
  let priceUsd = Math.round(Number(product.price_usd) * quantity * 100) / 100;
  if (mode === "admin_link") {
    const custom = Number(body.price_usd);
    if (!Number.isFinite(custom) || custom <= 0 || custom > 100000) return json({ error: "invalid_price" }, 400);
    priceUsd = Math.round(custom * 100) / 100;
  }

  // Comprador
  let studentId: string | null = null;
  let buyerName = String(body.name || "").trim();
  let buyerEmail = String(body.email || "").trim().toLowerCase();
  if (mode === "admin_link" && body.student_id) {
    const { data: st } = await db.from("students").select("id, full_name, email").eq("id", String(body.student_id)).maybeSingle();
    if (!st?.email) return json({ error: "student_needs_email" }, 400);
    studentId = st.id;
    buyerName = st.full_name.replace(/\s*[-–]\s*frequency\s*lab\.?\s*$/i, "").trim();
    buyerEmail = st.email;
  } else if (userId) {
    const { data: st } = await db.from("students").select("id, full_name, email").eq("user_id", userId).maybeSingle();
    if (st && mode === "shop") {
      studentId = st.id;
      buyerEmail = buyerEmail || st.email || "";
      buyerName = buyerName || st.full_name.replace(/\s*[-–]\s*frequency\s*lab\.?\s*$/i, "").trim();
    }
  }
  if (buyerName.length < 2 || buyerName.length > 120) return json({ error: "invalid_name" }, 400);
  if (!EMAIL_RE.test(buyerEmail) || buyerEmail.length > 200) return json({ error: "invalid_email" }, 400);

  // Anti-spam del shop: máx. 3 órdenes pendientes por email en la última hora
  if (mode === "shop") {
    const { count } = await db.from("orders").select("id", { count: "exact", head: true })
      .eq("buyer_email", buyerEmail).eq("status", "pending")
      .gt("created_at", new Date(Date.now() - 3600_000).toISOString());
    if ((count || 0) >= 3) return json({ error: "too_many_orders" }, 429);
  }

  const mep = await fetchMep();
  if (!mep) return json({ error: "fx_unavailable" }, 503);
  const amountArs = Math.ceil(priceUsd * mep); // pesos enteros, redondeo hacia arriba

  const note = mode === "admin_link" ? String(body.note || "").trim().slice(0, 500) || null : null;
  const { data: order, error: oErr } = await db.from("orders").insert({
    product_id: product.id,
    product_name: quantity > 1 ? `${product.name} ×${quantity}` : product.name,
    quantity,
    kind: product.kind,
    student_id: studentId,
    buyer_name: buyerName,
    buyer_email: buyerEmail,
    source: mode,
    price_usd: priceUsd,
    fx_mep: mep,
    amount_ars: amountArs,
    note,
    created_by: mode === "admin_link" ? userId : null,
    expires_at: new Date(Date.now() + (mode === "admin_link" ? 7 : 3) * 86400_000).toISOString(),
  }).select("id, expires_at").single();
  if (oErr || !order) {
    console.error("[mp-checkout] order", oErr?.message);
    return json({ error: "order_failed" }, 500);
  }

  const site = Deno.env.get("SITE_URL") || "https://manupavez.com";
  const back = (estado: string) => `${site}/shop.html?pago=${estado}&orden=${order.id}`;
  const pref = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "X-Idempotency-Key": order.id },
    body: JSON.stringify({
      // Un solo ítem por el total: el monto en ARS queda exacto y fijo
      items: [{ id: product.slug, title: quantity > 1 ? `${product.name} ×${quantity}` : product.name, quantity: 1, unit_price: amountArs, currency_id: "ARS" }],
      payer: { email: buyerEmail, name: buyerName },
      external_reference: order.id,
      metadata: { order_id: order.id },
      notification_url: `${url}/functions/v1/mp-webhook`,
      back_urls: { success: back("ok"), failure: back("error"), pending: back("pendiente") },
      auto_return: "approved",
      statement_descriptor: "FREQUENCY LAB",
      expires: true,
      expiration_date_to: order.expires_at,
    }),
  });
  const prefBody = await pref.json().catch(() => ({}));
  if (!pref.ok || !prefBody.init_point) {
    console.error("[mp-checkout] preference", pref.status, JSON.stringify(prefBody).slice(0, 300));
    await db.from("orders").update({ status: "cancelled" }).eq("id", order.id);
    return json({ error: "mp_failed" }, 502);
  }

  await db.from("orders").update({ mp_preference_id: prefBody.id, init_point: prefBody.init_point }).eq("id", order.id);
  return json({ order_id: order.id, init_point: prefBody.init_point, amount_ars: amountArs, fx_mep: mep, price_usd: priceUsd, quantity });
});
