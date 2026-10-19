// supabase/functions/lab-apply/index.ts
// Guarda cada aplicación al Frequency Lab (/aplicar y /clinicas) en lab_leads, para el mail de
// seguimiento a los 3 días (lab-followup). El aviso a Manu sigue saliendo por FormSubmit desde la web.
//
// Público: campo trampa (website) + límite de 3 aplicaciones por mail en 24 h y 200 por día en total.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { clean, cleanText, EMAIL_RE, cors, responder } from "../_shared/public.ts";

// ilike sin comodines: los "_" de un mail no deben matchear cualquier letra
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

Deno.serve(async (req) => {
  const json = responder(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (clean(body.website)) return json({ ok: true }); // bot: se ignora en silencio

  const email = clean(body.email, 200).toLowerCase();
  const name = clean(body.name, 120);
  if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);
  if (name.length < 1) return json({ error: "invalid_name" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [{ count: mine }, { count: all }] = await Promise.all([
    db.from("lab_leads").select("id", { count: "exact", head: true }).ilike("email", likeExact(email)).gt("created_at", dayAgo),
    db.from("lab_leads").select("id", { count: "exact", head: true }).gt("created_at", dayAgo),
  ]);
  if ((mine ?? 0) >= 3 || (all ?? 0) >= 200) return json({ ok: true, throttled: true });

  const { error } = await db.from("lab_leads").insert({
    name,
    email,
    level: clean(body.level, 40) || null,
    goal: clean(body.goal, 300) || null,
    message: cleanText(body.message) || null,
    source: clean(body.source, 300) || null,
  });
  if (error) {
    console.error("[lab-apply] insert", error.message);
    return json({ error: "save_failed" }, 500);
  }
  return json({ ok: true });
});
