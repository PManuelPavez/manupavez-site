// supabase/functions/order-mark-paid/index.ts
// Marca una orden como pagada a mano (transferencia / efectivo / otro) desde el panel.
//
// 1. Solo admin (JWT + profiles.is_admin).
// 2. Si la orden tiene link de MercadoPago y está pendiente, se vence ese link
//    para que no puedan pagar dos veces. Si MP falla, se sigue igual y se avisa.
// 3. mark_order_paid_manual(): pagada + si es la mentoría, activa/extiende 30 días.
//
// Secretos: MP_ACCESS_TOKEN (para anular el link).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ALLOWED = [/^https:\/\/(www\.)?manupavez\.com$/, /^http:\/\/localhost:\d+$/];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = new Set(["transferencia", "efectivo", "otro"]);

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
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const orderId = String(body.order_id || "");
  const studentId = body.student_id ? String(body.student_id) : null;
  const method = String(body.method || "transferencia");
  const note = String(body.note || "").slice(0, 500);
  if (!UUID_RE.test(orderId)) return json({ error: "invalid_order" }, 400);
  if (studentId && !UUID_RE.test(studentId)) return json({ error: "invalid_student" }, 400);
  if (!METHODS.has(method)) return json({ error: "invalid_method" }, 400);

  const { data: order } = await db.from("orders").select("id, status, kind, student_id, mp_preference_id").eq("id", orderId).maybeSingle();
  if (!order) return json({ result: "not_found" }, 404);

  // Validar ANTES de tocar MercadoPago: si algo falta, el link de pago sigue vivo
  if (order.status === "paid") return json({ result: "already_paid" });
  if (!["pending", "expired"].includes(order.status)) return json({ result: "invalid_status", status: order.status });
  if (order.kind === "plan" && !studentId && !order.student_id) return json({ result: "student_required" });

  // Anular el link de MercadoPago ANTES de marcar pagada (así no queda una ventana para pagar dos veces)
  let mpLinkStillActive = false;
  if (order.mp_preference_id && order.status === "pending") {
    const token = Deno.env.get("MP_ACCESS_TOKEN");
    try {
      const res = token
        ? await fetch(`https://api.mercadopago.com/checkout/preferences/${encodeURIComponent(order.mp_preference_id)}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ expires: true, expiration_date_to: new Date().toISOString() }),
          })
        : null;
      mpLinkStillActive = !res?.ok;
      if (res && !res.ok) console.error("[order-mark-paid] mp", res.status, (await res.text().catch(() => "")).slice(0, 200));
    } catch (e) {
      mpLinkStillActive = true;
      console.error("[order-mark-paid] mp", (e as Error).message);
    }
  }

  const { data: result, error } = await db.rpc("mark_order_paid_manual", {
    p_order_id: orderId,
    p_admin: u.user.id,
    p_student_id: studentId,
    p_method: method,
    p_note: note,
  });
  if (error) {
    console.error("[order-mark-paid] rpc", error.message);
    return json({ error: "failed" }, 500);
  }

  return json({ ...result, mp_link_still_active: mpLinkStillActive && result?.result === "paid" });
});
