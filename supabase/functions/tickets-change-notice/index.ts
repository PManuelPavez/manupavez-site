// supabase/functions/tickets-change-notice/index.ts
// Avisa el cambio de fecha y lugar a quienes ya compraron.
//
// Lo usa el botón del panel de ventas (admin: JWT + profiles.is_admin) o una clave de servicio.
//  · {"test": true}  → manda un ejemplo solo a Manu (LAB_TO_EMAIL).
//  · {"send": true}  → manda a cada compra pagada (no invitados) con mail que todavía no
//    lo recibió (change_notice_sent_at vacío). Tocarlo de nuevo no repite.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { sendMail, ticketChangeHtml } from "../_shared/tickets.ts";

const ALLOWED = [/^https:\/\/(www\.)?manupavez\.com$/, /^http:\/\/localhost:\d+$/];
const cors = (req: Request) => {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED.some((re) => re.test(origin)) ? origin : "https://manupavez.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
};

// Admin del panel (JWT + is_admin) o clave de servicio del proyecto
async function authorized(token: string): Promise<boolean> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (token.split(".").length === 3) {
    const { data: u } = await svc.auth.getUser(token);
    if (u?.user) {
      const { data: prof } = await svc.from("profiles").select("is_admin").eq("user_id", u.user.id).maybeSingle();
      if (prof?.is_admin === true) return true;
    }
  }
  const probe = createClient(url, token, { auth: { persistSession: false } });
  const { error } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !(await authorized(token))) return json({ error: "unauthorized" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* nada */ }
  const slug = String(body.slug || "pergamino");
  const { data: ev } = await db.from("events")
    .select("id, name, event_date, venue, address, time_text, lineup, flyer_url").eq("slug", slug).maybeSingle();
  if (!ev) return json({ error: "no_event" }, 404);
  const subject = `Cambio de fecha: sábado 14/11 — ${ev.name}`;

  if (body.test) {
    const to = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
    const html = ticketChangeHtml(ev, [{ first_name: "Nombre", last_name: "Ejemplo" }]);
    let err = await sendMail(to, `[EJEMPLO] ${subject}`, html);
    if (err) err = await sendMail(to, `[EJEMPLO] ${subject}`, html, "LOWTIDE.ART <onboarding@resend.dev>");
    return json({ test: true, sent: !err, error: err });
  }
  if (!body.send) return json({ error: "nothing_to_do" }, 400);

  const { data: orders } = await db.from("ticket_orders").select("id, buyer_email")
    .eq("event_id", ev.id).eq("status", "approved").neq("method", "invitado").not("buyer_email", "is", null)
    .is("change_notice_sent_at", null);
  let sent = 0;
  const failed: string[] = [];
  for (const o of orders || []) {
    const { data: people } = await db.from("attendees").select("first_name, last_name").eq("order_id", o.id).order("created_at");
    const err = await sendMail([o.buyer_email], subject, ticketChangeHtml(ev, people || []));
    if (err) { failed.push(err); continue; }
    sent++;
    await db.from("ticket_orders").update({ change_notice_sent_at: new Date().toISOString() }).eq("id", o.id);
  }
  return json({ total: (orders || []).length, sent, failed: failed.length, error: failed[0] || null });
});
