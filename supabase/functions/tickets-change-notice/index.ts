// supabase/functions/tickets-change-notice/index.ts
// Avisa el cambio de fecha y lugar a quienes ya compraron.
//
// Solo con una clave de servicio del proyecto (se llama a mano).
//  · {"test": true}  → manda un ejemplo solo a Manu (LAB_TO_EMAIL).
//  · {"send": true}  → manda a cada compra pagada (no invitados) con mail. Usar una sola vez.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { sendMail, ticketChangeHtml } from "../_shared/tickets.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const key = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!key) return json({ error: "unauthorized" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const { error: authErr } = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (authErr) return json({ error: "unauthorized" }, 401);

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
    .eq("event_id", ev.id).eq("status", "approved").neq("method", "invitado").not("buyer_email", "is", null);
  let sent = 0;
  const failed: string[] = [];
  for (const o of orders || []) {
    const { data: people } = await db.from("attendees").select("first_name, last_name").eq("order_id", o.id).order("created_at");
    const err = await sendMail([o.buyer_email], subject, ticketChangeHtml(ev, people || []));
    if (err) failed.push(err); else sent++;
  }
  return json({ total: (orders || []).length, sent, failed: failed.length, error: failed[0] || null });
});
