// supabase/functions/notion-file/index.ts
// Entrega un link FRESCO a un archivo subido a Notion (ejecutables, zips, PDFs, audios…).
// Notion firma esas URLs por 1 hora: por eso el sync guarda solo el id del bloque y
// este endpoint pide la URL vigente recién cuando el alumno toca el archivo.
//
// Seguridad:
//  · Requiere sesión (JWT). Alumno: acceso vigente y el archivo tiene que estar en
//    SU página o SUS sesiones. Admin: cualquier archivo que esté en alguna página del Lab.
//  · Nunca actúa de proxy de bloques arbitrarios de Notion (notion_file_allowed).
// Secretos: NOTION_TOKEN.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ALLOWED = [/^https:\/\/(www\.)?manupavez\.com$/, /^http:\/\/localhost:\d+$/];

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

  let blockId = "";
  try { blockId = String((await req.json())?.block_id || "").trim().toLowerCase(); } catch { /* body inválido */ }
  if (!/^[0-9a-f-]{32,36}$/.test(blockId)) return json({ error: "invalid_block" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // ¿Quién pide?
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return json({ error: "unauthorized" }, 401);
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return json({ error: "unauthorized" }, 401);

  const { data: prof } = await db.from("profiles").select("is_admin").eq("user_id", u.user.id).maybeSingle();
  let studentId: string | null = null;
  if (prof?.is_admin !== true) {
    const { data: st } = await db
      .from("students")
      .select("id, status, memberships(status, current_period_end)")
      .eq("user_id", u.user.id)
      .maybeSingle();
    const m = Array.isArray(st?.memberships) ? st?.memberships[0] : st?.memberships;
    const active = st?.status === "active" && m?.status === "active" &&
      (!m.current_period_end || new Date(m.current_period_end) > new Date());
    if (!st || !active) return json({ error: "forbidden" }, 403);
    studentId = st.id;
  }

  // El archivo tiene que ser de este alumno (o de alguna página del Lab, si es admin)
  const { data: allowed } = await db.rpc("notion_file_allowed", { p_block_id: blockId, p_student_id: studentId });
  if (allowed !== true) return json({ error: "not_found" }, 404);

  const token = Deno.env.get("NOTION_TOKEN");
  if (!token) return json({ error: "unavailable" }, 503);
  const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" },
  });
  if (!res.ok) return json({ error: res.status === 404 ? "not_found" : "unavailable" }, res.status === 404 ? 404 : 502);
  const block = await res.json();
  const v = block?.[block?.type] || {};
  const url = v?.type === "file" ? v.file?.url : v?.type === "external" ? v.external?.url : null;
  if (!url || !/^https:\/\//.test(url)) return json({ error: "not_found" }, 404);

  return json({ url, name: v.name || null, expires: v.file?.expiry_time || null });
});
