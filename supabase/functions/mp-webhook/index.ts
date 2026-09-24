// supabase/functions/mp-webhook/index.ts
// Notificaciones de pago de MercadoPago.
//
// Regla de oro: NUNCA se confía en lo que llega en la notificación.
//  1. Se valida la firma (x-signature) con MP_WEBHOOK_SECRET.
//  2. Se vuelve a pedir el pago a la API de MercadoPago con nuestro token.
//  3. Solo si está "approved", en ARS, con nuestra orden y el monto correcto, se da por pagado.
//  4. Cada pago se procesa una sola vez (payment_events).
// Pagado: mentoría → activa/extiende 30 días. Servicio/pack → mail para coordinar la entrega.
//
// Secretos: MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, RESEND_API_KEY. Opcionales: LAB_FROM_EMAIL, LAB_TO_EMAIL.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function hmacHex(secret: string, msg: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Firma de MercadoPago: x-signature "ts=…,v1=…"; manifiesto "id:<data.id>;request-id:<x-request-id>;ts:<ts>;"
async function validSignature(req: Request, dataId: string): Promise<boolean> {
  const secret = Deno.env.get("MP_WEBHOOK_SECRET");
  if (!secret) return false;
  const header = req.headers.get("x-signature") || "";
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=").map((s) => s.trim())));
  if (!parts.ts || !parts.v1) return false;
  const requestId = req.headers.get("x-request-id") || "";
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${parts.ts};`;
  return safeEqual(await hmacHex(secret, manifest), parts.v1);
}

async function notifyAdmin(subject: string, html: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  const from = Deno.env.get("LAB_FROM_EMAIL") || "Frequency Lab <onboarding@resend.dev>";
  const to = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  }).catch(() => {});
}

const money = (n: number, cur: string) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: cur, maximumFractionDigits: cur === "ARS" ? 0 : 2 }).format(n);

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ error: "method_not_allowed" }, 405);

  const u = new URL(req.url);
  let body: any = {};
  try { body = await req.json(); } catch { /* MP a veces manda solo query */ }
  const type = String(body?.type || u.searchParams.get("type") || u.searchParams.get("topic") || "");
  const dataId = String(body?.data?.id || u.searchParams.get("data.id") || u.searchParams.get("id") || "");

  // Solo pagos; el resto se ignora con 200 para que MP no reintente
  if (type !== "payment" || !/^\d{1,20}$/.test(dataId)) return ok({ ignored: true });
  if (!(await validSignature(req, dataId))) return ok({ error: "invalid_signature" }, 401);

  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!token) return ok({ error: "payments_not_configured" }, 503);

  // Fuente de verdad: la API de MercadoPago, no el cuerpo de la notificación
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, { headers: { Authorization: `Bearer ${token}` } });
  // Pago inexistente (p. ej. el "Simular" del panel de MP): se ignora con 200.
  // Si la firma pasó, el simulador muestra ✅ y confirma que MP_WEBHOOK_SECRET está bien.
  if (res.status === 404) return ok({ ignored: "payment_not_found" });
  if (!res.ok) return ok({ error: "mp_unavailable" }, 502); // MP reintenta
  const pay = await res.json();

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const orderId = String(pay.external_reference || "");
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return ok({ ignored: "no_order" });

  // Idempotencia: el mismo pago en el mismo estado se procesa una sola vez
  const eventId = `${pay.id}:${pay.status}`;
  const { error: dupErr } = await db.from("payment_events").insert({
    id: eventId,
    order_id: orderId,
    payload: { id: pay.id, status: pay.status, status_detail: pay.status_detail, amount: pay.transaction_amount, currency: pay.currency_id },
  });
  if (dupErr) return ok({ duplicate: true });

  const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return ok({ ignored: "order_not_found" });

  if (pay.status !== "approved") {
    if (pay.status === "rejected" && order.status === "pending") {
      // Se deja "pending": el comprador puede reintentar con otro medio en el mismo link
    }
    if (pay.status === "refunded" || pay.status === "charged_back") {
      await db.from("orders").update({ status: "refunded" }).eq("id", order.id);
      await notifyAdmin(`Frequency Lab — Pago devuelto: ${order.product_name}`,
        `<p>El pago de <strong>${esc(order.buyer_name)}</strong> (${esc(order.buyer_email)}) por <strong>${esc(order.product_name)}</strong> fue devuelto o desconocido (${esc(pay.status)}).</p><p>Revisá si corresponde revocar el acceso.</p>`);
    }
    return ok({ status: pay.status });
  }

  // Controles antes de dar por pagado
  const amountOk = pay.currency_id === "ARS" && Number(pay.transaction_amount) + 1 >= Number(order.amount_ars);
  if (!amountOk) {
    await notifyAdmin(`Frequency Lab — ⚠ Pago con monto distinto: ${order.product_name}`,
      `<p>Llegó un pago aprobado para la orden de <strong>${esc(order.buyer_name)}</strong> pero no coincide con lo esperado.</p>
       <p>Esperado: ${money(Number(order.amount_ars), "ARS")} — Recibido: ${esc(pay.transaction_amount)} ${esc(pay.currency_id)}</p>
       <p>No se activó nada. Revisalo en MercadoPago (pago ${esc(pay.id)}).</p>`);
    return ok({ error: "amount_mismatch" });
  }

  const { data: result, error: fErr } = await db.rpc("fulfill_paid_order", { p_order_id: order.id, p_payment_id: String(pay.id) });
  if (fErr) {
    // Se borra el evento para que el reintento de MP lo procese
    await db.from("payment_events").delete().eq("id", eventId);
    return ok({ error: "fulfill_failed" }, 500);
  }
  if (result?.result === "already_paid") return ok({ already_paid: true });

  const lines = [
    `<p><strong>${esc(order.buyer_name)}</strong> (${esc(order.buyer_email)}) pagó <strong>${esc(order.product_name)}</strong>.</p>`,
    `<p>${money(Number(order.price_usd), "USD")} · MEP ${esc(order.fx_mep)} · cobrado ${money(Number(pay.transaction_amount), "ARS")}${order.source === "admin_link" ? " · link con precio especial" : ""}</p>`,
  ];
  if (order.kind === "plan") {
    lines.push(result?.plan === "activated"
      ? `<p>✅ Acceso al Lab activado hasta el <strong>${new Date(result.until).toLocaleDateString("es-AR")}</strong>.</p>`
      : `<p>⚠ No hay un alumno con ese email: crealo en el panel (email + PIN) y activale 30 días.</p>`);
  } else {
    lines.push(`<p>👉 Coordiná la entrega con el comprador.</p>`);
  }
  if (order.note) lines.push(`<p>Nota: ${esc(order.note)}</p>`);
  lines.push(`<p><a href="https://manupavez.com/admin.html">Abrir el panel →</a></p>`);

  await notifyAdmin(`Frequency Lab — Nueva compra: ${order.product_name} (${order.buyer_name})`,
    `<div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.55;color:#0a0a0a;max-width:560px">${lines.join("")}</div>`);

  return ok({ paid: true });
});
