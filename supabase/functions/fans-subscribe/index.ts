// supabase/functions/fans-subscribe/index.ts
// Alta en la lista de fans desde la web ("Avisame de nuevas fechas"). Consentimiento explícito:
// la persona escribe su mail y toca el botón. Campo trampa (website); repetir el mail no duplica.
// Las altas desde entradas / lista de espera las hace tickets-checkout (casilla marcada).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { clean, EMAIL_RE, cors, responder } from "../_shared/public.ts";

Deno.serve(async (req) => {
  const json = responder(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (clean(body.website)) return json({ ok: true });

  const email = clean(body.email, 200).toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { error } = await db.rpc("fan_upsert", {
    p_email: email,
    p_name: clean(body.name, 120),
    p_phone: "",
    p_city: clean(body.city, 80),
    p_source: "web",
    p_event_slug: null,
  });
  if (error) {
    console.error("[fans-subscribe]", error.message);
    return json({ error: "save_failed" }, 500);
  }
  return json({ ok: true });
});
