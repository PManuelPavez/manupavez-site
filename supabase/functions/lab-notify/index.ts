// supabase/functions/lab-notify/index.ts
// Avisa por mail (Resend) cuando un alumno sube un track o completa una misión.
// La llama pg_cron cada 5 min, solo si hay novedades pendientes (lab_events).
// Manda UN mail por alumno con todo lo nuevo y marca los eventos como enviados.
//
// Secretos: RESEND_API_KEY (ya existe). Opcionales: LAB_FROM_EMAIL, LAB_TO_EMAIL.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const displayName = (full: string) => full.replace(/\s*[-–]\s*frequency\s*lab\.?\s*$/i, "").trim() || full;

// Busca el texto de una misión (to_do) por su id dentro del espejo de Notion
function findTaskText(content: any, id: string): string | null {
  for (const row of content?.rows || []) {
    for (const col of row.cols || []) {
      for (const sec of col || []) {
        const it = (sec.items || []).find((i: any) => i.t === "task" && i.id === id);
        if (it) return it.text;
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Solo el cron (secreto generado en Vault)
  const secret = req.headers.get("x-notify-secret") || "";
  const { data: ok } = await db.rpc("verify_notify_secret", { p_secret: secret });
  if (ok !== true) return json({ error: "unauthorized" }, 401);

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return json({ error: "missing_resend_api_key" }, 500);
  const FROM = Deno.env.get("LAB_FROM_EMAIL") || "Frequency Lab <onboarding@resend.dev>";
  const TO = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);

  const { data: events, error } = await db
    .from("lab_events")
    .select("id, student_id, kind, ref_id, payload, created_at, students(full_name)")
    .is("sent_at", null)
    .lt("created_at", new Date(Date.now() - 2 * 60_000).toISOString())
    .order("created_at")
    .limit(200);
  if (error) return json({ error: "db_error" }, 500);
  if (!events?.length) return json({ ok: true, sent: 0 });

  // Agrupar por alumno
  const byStudent = new Map<string, any[]>();
  for (const e of events) byStudent.set(e.student_id, [...(byStudent.get(e.student_id) || []), e]);

  let sent = 0;
  for (const [studentId, list] of byStudent) {
    const name = displayName((list[0] as any).students?.full_name || "Un alumno");

    const needsDash = list.some((e) => e.kind === "task_done");
    const { data: dash } = needsDash
      ? await db.from("student_dashboards").select("content").eq("student_id", studentId).maybeSingle()
      : { data: null };

    const tracks = list.filter((e) => e.kind === "track_added");
    const tasks = list.filter((e) => e.kind === "task_done");

    const parts: string[] = [];
    if (tracks.length) parts.push(`${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`);
    if (tasks.length) parts.push(`${tasks.length} ${tasks.length === 1 ? "misión completada" : "misiones completadas"}`);
    const subject = `Frequency Lab — ${name}: ${parts.join(" y ")}`;

    const trackRows = tracks.map((e) => {
      const url = String(e.payload?.url || "");
      const safe = url.startsWith("https://") ? url : "";
      return `<li style="margin:0 0 8px">♪ <strong>${esc(e.payload?.title)}</strong>${safe ? ` — <a href="${esc(safe)}">${esc(safe)}</a>` : ""}</li>`;
    }).join("");
    const taskRows = tasks.map((e) =>
      `<li style="margin:0 0 8px">✓ ${esc(findTaskText(dash?.content, e.ref_id) || "Misión (ya no está en Notion)")}</li>`
    ).join("");

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.55;color:#0a0a0a;max-width:560px">
        <p style="margin:0 0 4px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.6">Frequency Lab</p>
        <h2 style="font-weight:600;margin:0 0 16px">Novedades de ${esc(name)}</h2>
        ${tracks.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Subió ${tracks.length === 1 ? "un track" : "tracks"}</h3><ul style="padding-left:18px;margin:0">${trackRows}</ul>` : ""}
        ${tasks.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Completó ${tasks.length === 1 ? "una misión" : "misiones"}</h3><ul style="padding-left:18px;margin:0">${taskRows}</ul>` : ""}
        <p style="margin-top:24px;font-size:13px"><a href="https://manupavez.com/admin.html">Abrir el panel de alumnos →</a></p>
      </div>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: TO, subject, html }),
    });

    // Si Resend falla, los eventos quedan pendientes y se reintentan en la próxima corrida
    if (!res.ok) {
      console.error("[lab-notify] resend", res.status, (await res.text().catch(() => "")).slice(0, 200));
      continue;
    }
    await db.from("lab_events").update({ sent_at: new Date().toISOString() }).in("id", list.map((e) => e.id));
    sent++;
  }

  return json({ ok: true, sent });
});
