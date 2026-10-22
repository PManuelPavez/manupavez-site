// supabase/functions/tickets-resend/index.ts
// Reenvía el mail "Estás en la lista" desde el panel de ventas.
//
// 1. Solo admin (JWT + profiles.is_admin).
// 2. Sin order_id: todos los pedidos pagos que todavía no recibieron el mail
//    (email_sent_at vacío). Con order_id: solo ese pedido (aunque ya lo haya recibido).
// 3. Usa sendTicketConfirmation, que guarda email_sent_at / email_error en el pedido.
//
// Secretos: RESEND_API_KEY y TICKETS_FROM_EMAIL (remitente con dominio verificado).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { sendTicketConfirmation } from "../_shared/tickets.ts";

const ALLOWED = [/^https:\/\/(www\.)?manupavez\.com$/, /^http:\/\/localhost:\d+$/];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PER_CALL = 50;

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
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Solo admin
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt || jwt.split(".").length !== 3) return json({ error: "unauthorized" }, 401);
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return json({ error: "unauthorized" }, 401);
  const { data: prof } = await db.from("profiles").select("is_admin").eq("user_id", u.user.id).maybeSingle();
  if (prof?.is_admin !== true) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo = todos los pendientes */ }
  const orderId = body.order_id ? String(body.order_id) : null;
  if (orderId && !UUID_RE.test(orderId)) return json({ error: "invalid_order" }, 400);

  let q = db.from("ticket_orders").select("id")
    .eq("status", "approved").neq("method", "invitado").not("buyer_email", "is", null);
  q = orderId ? q.eq("id", orderId) : q.is("email_sent_at", null);
  const { data: orders, error } = await q.order("created_at").limit(MAX_PER_CALL);
  if (error) return json({ error: "db_error" }, 500);

  let sent = 0;
  const failed: string[] = [];
  for (const o of orders || []) {
    const err = await sendTicketConfirmation(db, o.id);
    if (err) failed.push(err);
    else sent++;
  }
  // Un solo motivo de error alcanza para el panel (suelen ser todos iguales)
  return json({ total: (orders || []).length, sent, failed: failed.length, error: failed[0] || null });
});
