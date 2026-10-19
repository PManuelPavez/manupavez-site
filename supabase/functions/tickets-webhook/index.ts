// supabase/functions/tickets-webhook/index.ts
// Notificaciones de MercadoPago para las entradas (notification_url de tickets-checkout).
//
// Igual que mp-webhook: nunca se confía en la notificación.
//  1. Firma x-signature con MP_WEBHOOK_SECRET.
//  2. Se vuelve a pedir el pago a la API de MP.
//  3. Aprobado, en ARS y por el total → ticket_confirm + mail "Estás en la lista".
//     Rechazado/cancelado → ticket_release (libera el stock).
//  4. Cada pago+estado se procesa una sola vez (ticket_payment_events).
// external_reference = "tk_<uuid>": así mp-webhook (shop) lo ignora si también le llega.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { ars, esc, notifyAdmin, sendTicketConfirmation } from "../_shared/tickets.ts";

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return ok({ error: "method_not_allowed" }, 405);

  const u = new URL(req.url);
  let body: any = {};
  try { body = await req.json(); } catch { /* MP a veces manda solo query */ }
  const type = String(body?.type || u.searchParams.get("type") || u.searchParams.get("topic") || "");
  const dataId = String(body?.data?.id || u.searchParams.get("data.id") || u.searchParams.get("id") || "");

  if (type !== "payment" || !/^\d{1,20}$/.test(dataId)) return ok({ ignored: true });
  if (!(await validSignature(req, dataId))) return ok({ error: "invalid_signature" }, 401);

  const token = Deno.env.get("MP_ACCESS_TOKEN");
  if (!token) return ok({ error: "payments_not_configured" }, 503);

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return ok({ ignored: "payment_not_found" });
  if (!res.ok) return ok({ error: "mp_unavailable" }, 502); // MP reintenta
  const pay = await res.json();

  const m = /^tk_([0-9a-f-]{36})$/i.exec(String(pay.external_reference || ""));
  if (!m) return ok({ ignored: "not_a_ticket" });
  const orderId = m[1];

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const eventId = `${pay.id}:${pay.status}`;
  const { error: dupErr } = await db.from("ticket_payment_events").insert({
    id: eventId,
    order_id: orderId,
    payload: { id: pay.id, status: pay.status, status_detail: pay.status_detail, amount: pay.transaction_amount, currency: pay.currency_id },
  });
  if (dupErr) return ok({ duplicate: true });

  const { data: order } = await db.from("ticket_orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return ok({ ignored: "order_not_found" });
  const who = `${order.buyer_first_name} ${order.buyer_last_name}`;

  if (pay.status !== "approved") {
    if (["rejected", "cancelled"].includes(pay.status)) {
      await db.rpc("ticket_release", { p_order_id: order.id, p_status: "rejected" });
    }
    if ((pay.status === "refunded" || pay.status === "charged_back") && order.status === "approved") {
      await notifyAdmin(`Pergamino — Pago devuelto (${who})`,
        `<p>El pago de <strong>${esc(who)}</strong> (${esc(order.buyer_email)}) por ${order.quantity} entrada(s) fue devuelto o desconocido (${esc(pay.status)}).</p><p>Sacalo de la lista de puerta.</p>`);
    }
    return ok({ status: pay.status });
  }

  const amountOk = pay.currency_id === "ARS" && Number(pay.transaction_amount) + 1 >= Number(order.total_ars);
  if (!amountOk) {
    await notifyAdmin(`Pergamino — ⚠ Pago con monto distinto (${who})`,
      `<p>Llegó un pago aprobado para el pedido de <strong>${esc(who)}</strong> pero no coincide.</p>
       <p>Esperado: ${ars(order.total_ars)} — Recibido: ${esc(pay.transaction_amount)} ${esc(pay.currency_id)}</p>
       <p>No se confirmó. Revisalo en MercadoPago (pago ${esc(pay.id)}).</p>`);
    return ok({ error: "amount_mismatch" });
  }

  const { data: result, error: cErr } = await db.rpc("ticket_confirm", { p_order_id: order.id, p_payment_id: String(pay.id) });
  if (cErr) {
    await db.from("ticket_payment_events").delete().eq("id", eventId); // que el reintento de MP lo procese
    return ok({ error: "confirm_failed" }, 500);
  }
  if (result?.result === "already_approved") return ok({ already_approved: true });

  const mailErr = await sendTicketConfirmation(db, order.id);
  if (mailErr) console.error("[tickets-webhook] mail", mailErr);

  if (result?.oversold) {
    await notifyAdmin(`Pergamino — ⚠ Venta sin lugar en la tanda (${who})`,
      `<p>El pago de <strong>${esc(who)}</strong> (${order.quantity} entrada(s), ${esc(order.tier_name)}) se aprobó después de que venciera la reserva y la tanda ya no tenía lugar.</p>
       <p>Quedó aprobado igual (la persona pagó). Decidí si lo mantenés o devolvés el pago.</p>`);
  }
  return ok({ approved: true, mail: mailErr ? "failed" : "sent" });
});
