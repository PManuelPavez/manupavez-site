// supabase/functions/lab-mail-sample/index.ts
// Manda a Manu (LAB_TO_EMAIL) un EJEMPLO de los tres mails de Frequency Lab para alumnos:
// aviso de portal con nota, bienvenida (primer mes) y mes 3 de Resonancia.
// No lee ni modifica nada de la base.
//
// Solo con la service role key (se llama a mano, no desde la web), igual que tickets-sample.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { membershipPaidMail, notionUpdatedMail } from "../_shared/lab-mails.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function labFrom() {
  const lab = Deno.env.get("LAB_FROM_EMAIL");
  if (lab) return lab;
  const domain = ((Deno.env.get("TICKETS_FROM_EMAIL") || "").match(/@([^>\s]+)/) || [])[1];
  return domain ? `Frequency Lab <lab@${domain}>` : "Frequency Lab <onboarding@resend.dev>";
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const key = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!key) return json({ error: "unauthorized" }, 401);
  const probe = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const { error: authErr } = await probe.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (authErr) return json({ error: "unauthorized" }, 401);

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return json({ error: "missing_resend_api_key" }, 500);
  const from = labFrom();
  const to = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const fullName = "Luciano Ejemplo - Frequency LAB";

  const mails = [
    notionUpdatedMail({ fullName, note: "Te dejé el resumen de la clase y dos misiones nuevas para el drop.\nCualquier cosa me escribís." }),
    membershipPaidMail({ fullName, first: true, until, productSlug: "mentoria-mensual", productName: "Frecuencia" }),
    membershipPaidMail({ fullName, first: false, month: 3, until, productSlug: "ep-listo-para-enviar", productName: "Resonancia" }),
  ];

  const results = [];
  for (const m of mails) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: `[EJEMPLO] ${m.subject}`, html: m.html, reply_to: "manupavez22@gmail.com" }),
    });
    results.push({ subject: m.subject, ok: res.ok, error: res.ok ? null : (await res.text().catch(() => "")).slice(0, 200) });
  }
  return json({ from, to, results });
});
