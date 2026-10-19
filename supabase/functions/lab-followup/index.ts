// supabase/functions/lab-followup/index.ts
// Seguimiento de aplicaciones al Lab: UN mail por persona, entre 3 y 7 días después de aplicar,
// solo si no compró nada en el shop ni es alumno. Lo llama pg_cron una vez por día (lab-followup-daily).
//
// Remitente: LAB_FROM_EMAIL (dominio verificado en Resend). Si todavía es el de prueba
// (onboarding@resend.dev), Resend solo entrega al dueño de la cuenta: en ese caso NO se le escribe
// a la persona y Manu recibe un aviso con los datos para escribirle a mano.
// Secretos: RESEND_API_KEY. Opcionales: LAB_FROM_EMAIL, LAB_TO_EMAIL.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

// ilike sin comodines: los "_" de un mail no deben matchear cualquier letra
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

const SHOP_URL = "https://manupavez.com/shop.html";
const esc = (v: unknown) =>
  String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const firstName = (full: string) => (full || "").trim().split(/\s+/)[0] || "";

const WRAP = (inner: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#10232a;max-width:540px">${inner}</div>`;

// Texto en la voz de Manu: arranca desde lo que la persona escribió, sin urgencia ni "últimos cupos".
function followupMail(lead: { name: string; goal: string | null }) {
  const nombre = firstName(lead.name);
  const goal = (lead.goal || "").trim();
  const subject = "Lo que escribiste el otro día";
  const html = WRAP(`
    <p>Hola${nombre ? ` ${esc(nombre)}` : ""}:</p>
    <p>Hace unos días aplicaste al Frequency Lab${goal ? ` y escribiste que querés <em>«${esc(goal)}»</em>` : ""}. Lo leí.</p>
    <p>Muchos tracks se quedan dando vueltas en el mismo loop de ocho compases. No es por falta de ideas: todavía no está claro qué decisión viene después. Eso es lo que trabajamos en el Lab, sobre tu propio proyecto.</p>
    <p>Si querés, respondé este mail con un link a algo en lo que estés trabajando, aunque esté a medias, y te digo por dónde arrancaría yo.</p>
    <p>Y si ya lo tenés decidido, acá están los formatos: <a href="${SHOP_URL}" style="color:#0b6f65">ver formatos y precios</a>.</p>
    <p>Sin apuro. Cuando es el momento, se nota.</p>
    <p>Manu</p>`);
  return { subject, html };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Solo el cron (mismo secreto de Vault que lab-notify)
  const { data: ok } = await db.rpc("verify_notify_secret", { p_secret: req.headers.get("x-notify-secret") || "" });
  if (ok !== true) return json({ error: "unauthorized" }, 401);

  const KEY = Deno.env.get("RESEND_API_KEY");
  if (!KEY) return json({ error: "missing_resend_api_key" }, 500);
  const FROM = Deno.env.get("LAB_FROM_EMAIL") || "Manu Pavez <onboarding@resend.dev>";
  const TO_MANU = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);
  const testSender = /resend\.dev/i.test(FROM);

  const send = async (to: string[], subject: string, html: string): Promise<string | null> => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html, reply_to: "manupavez22@gmail.com" }),
    });
    return res.ok ? null : `resend_${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
  };

  const now = Date.now();
  const { data: leads, error } = await db.from("lab_leads")
    .select("id, name, email, goal, created_at")
    .is("followup_sent_at", null)
    .lt("created_at", new Date(now - 3 * 86_400_000).toISOString())
    .gt("created_at", new Date(now - 7 * 86_400_000).toISOString())
    .order("created_at")
    .limit(50);
  if (error) return json({ error: "db_error" }, 500);
  if (!leads?.length) return json({ ok: true, sent: 0 });

  // Una sola vez por mail (si aplicó dos veces, se sigue la primera)
  const seen = new Set<string>();
  let sent = 0, skipped = 0;
  const manual: string[] = [];

  for (const lead of leads) {
    const email = String(lead.email || "").toLowerCase();
    const mark = (fields: Record<string, unknown>) => db.from("lab_leads").update({ followup_sent_at: new Date().toISOString(), ...fields }).eq("id", lead.id);
    if (!email || seen.has(email)) { await mark({ followup_error: "duplicado" }); skipped++; continue; }
    seen.add(email);

    // ¿Ya compró o ya es alumno? Entonces no hace falta seguimiento.
    const [{ count: paid }, { count: student }] = await Promise.all([
      db.from("orders").select("id", { count: "exact", head: true }).ilike("buyer_email", likeExact(email)).eq("status", "paid"),
      db.from("students").select("id", { count: "exact", head: true }).ilike("email", likeExact(email)),
    ]);
    if ((paid ?? 0) > 0 || (student ?? 0) > 0) { await mark({ followup_error: "ya_compro" }); skipped++; continue; }

    if (testSender) {
      manual.push(`<li><strong>${esc(lead.name)}</strong> — <a href="mailto:${esc(email)}">${esc(email)}</a>${lead.goal ? ` · «${esc(lead.goal)}»` : ""}</li>`);
      await mark({ followup_error: "remitente_de_prueba: aviso a Manu" });
      continue;
    }

    const { subject, html } = followupMail(lead);
    const err = await send([email], subject, html);
    if (err) {
      // Sin marcar como enviado: el cron de mañana lo reintenta (mientras siga dentro de los 7 días)
      await db.from("lab_leads").update({ followup_error: err }).eq("id", lead.id);
      continue;
    }
    await mark({ followup_error: null });
    sent++;
  }

  if (manual.length) {
    await send(TO_MANU, `Seguimiento del Lab: ${manual.length} para escribir a mano`, WRAP(`
      <p>Estas personas aplicaron al Lab hace 3 días y no compraron. El mail automático no salió porque el remitente
      todavía es el de prueba de Resend (hay que verificar manupavez.com en Resend y cargar LAB_FROM_EMAIL).</p>
      <ul>${manual.join("")}</ul>`));
  }
  return json({ ok: true, sent, skipped, manual: manual.length });
});
