// supabase/functions/tickets-sample/index.ts
// Manda a Manu un EJEMPLO del mail "Estás en la lista": datos reales del evento,
// comprador inventado. No lee ni modifica ninguna venta.
//
// Solo con la service role key (se llama a mano, no desde la web).
// Si el remitente configurado todavía no está habilitado en Resend, reintenta con el
// remitente de prueba (onboarding@resend.dev), que sí llega al dueño de la cuenta.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { sendMail, ticketEmailHtml } from "../_shared/tickets.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  // Solo una clave de servicio del proyecto: con ella se puede listar usuarios; con otra, no.
  const key = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!key) return json({ error: "unauthorized" }, 401);
  const probe = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const { error: authErr } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (authErr) return json({ error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo: evento por defecto */ }
  const slug = String(body.slug || "pergamino");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const { data: ev } = await db.from("events")
    .select("id, name, event_date, venue, address, time_text, lineup").eq("slug", slug).maybeSingle();
  if (!ev) return json({ error: "no_event" }, 404);
  const { data: tier } = await db.from("ticket_tiers").select("name, price_ars")
    .eq("event_id", ev.id).eq("active", true).order("sort").limit(1).maybeSingle();

  const order = { id: "e1e2e3e4-0000-0000-0000-000000000000", quantity: 2, tier_name: tier?.name || "Early", total_ars: (tier?.price_ars || 13000) * 2 };
  const people = [{ first_name: "Nombre", last_name: "Ejemplo" }, { first_name: "Amiga", last_name: "Ejemplo" }];
  const to = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  const subject = `[EJEMPLO] Estás en la lista — ${ev.name}`;
  const html = ticketEmailHtml(ev, order, people);

  let usedFallback = false;
  let err = await sendMail(to, subject, html);
  if (err) {
    usedFallback = true;
    err = await sendMail(to, subject, html, "LOWTIDE.ART <onboarding@resend.dev>");
  }
  return json({ sent: !err, to, usedFallback, error: err });
});
