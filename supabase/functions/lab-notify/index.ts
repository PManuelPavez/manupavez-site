// supabase/functions/lab-notify/index.ts
// Avisos por mail (Resend) a partir de lab_events. La llama pg_cron cada 5 min,
// solo si hay novedades pendientes. Agrupa todo en UN mail por alumno para Manu.
//
//  · track_added / task_done   → mail a Manu (novedades del alumno)
//  · membership_expiring        → mail AL ALUMNO con el link para renovar + resumen a Manu
//  · membership_lapsed          → mail a Manu: "{alumno} quedó sin acceso por falta de pago"
//
// Mail al alumno: necesita un remitente con dominio verificado en Resend (LAB_FROM_EMAIL).
// Con el remitente de prueba (onboarding@resend.dev) Resend solo entrega a la casilla
// del dueño de la cuenta: en ese caso el resumen a Manu lo aclara.
//
// Secretos: RESEND_API_KEY (ya existe). Opcionales: LAB_FROM_EMAIL, LAB_TO_EMAIL.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const SHOP_URL = "https://manupavez.com/shop.html";

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
const firstName = (full: string) => displayName(full).split(/\s+/)[0] || displayName(full);

// Fecha en Argentina (dd/mm)
const argDay = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

const WRAP = (inner: string) =>
  `<div style="font-family:system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;line-height:1.55;color:#0a0a0a;max-width:560px">${inner}</div>`;

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

  const send = async (to: string[], subject: string, html: string, replyTo?: string) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    if (!res.ok) console.error("[lab-notify] resend", res.status, (await res.text().catch(() => "")).slice(0, 200));
    return res.ok;
  };

  const { data: events, error } = await db
    .from("lab_events")
    .select("id, student_id, kind, ref_id, payload, created_at, students(full_name, email)")
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
    const student = (list[0] as any).students || {};
    const name = displayName(student.full_name || "Un alumno");
    const studentEmail: string | null = student.email || null;

    const tracks = list.filter((e) => e.kind === "track_added");
    const tasks = list.filter((e) => e.kind === "task_done");
    const expiring = list.filter((e) => e.kind === "membership_expiring");
    const lapsed = list.filter((e) => e.kind === "membership_lapsed");

    const needsDash = tasks.length > 0;
    const { data: dash } = needsDash
      ? await db.from("student_dashboards").select("content").eq("student_id", studentId).maybeSingle()
      : { data: null };

    // ── Aviso al alumno: su mentoría vence pronto ──
    let expiringNote = "";
    if (expiring.length) {
      const until = String(expiring[expiring.length - 1].payload?.until || "");
      const day = until ? argDay(until) : "";
      if (!studentEmail) {
        expiringNote = `No le llegó el aviso: <strong>no tiene mail cargado</strong> en el panel. Avisale vos para que renueve.`;
      } else {
        const delivered = await send(
          [studentEmail],
          `Tu mentoría de Frequency Lab vence el ${day}`,
          WRAP(`
            <p style="margin:0 0 4px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.6">Frequency Lab</p>
            <h2 style="font-weight:600;margin:0 0 16px">Hola ${esc(firstName(student.full_name || ""))}</h2>
            <p>Tu mentoría vence el <strong>${esc(day)}</strong>. Para seguir sin cortes con tus sesiones y tu espacio, renovala acá:</p>
            <p style="margin:20px 0"><a href="${SHOP_URL}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#0a0a0a;color:#fff;text-decoration:none">Renovar mi mentoría</a></p>
            <p style="font-size:13px;opacity:.7">Si ya la pagaste por transferencia, ignorá este mensaje. Cualquier duda, respondé este mail.</p>`),
          TO[0],
        );
        expiringNote = delivered
          ? `Le avisamos a ${esc(name)} (${esc(studentEmail)}) que vence el ${esc(day)}, con el link para renovar.`
          : `⚠ No se pudo mandar el aviso a ${esc(studentEmail)}. Si el remitente es el de prueba de Resend, falta verificar el dominio manupavez.com en Resend. Avisale vos.`;
      }
      expiringNote = `<p>Su mentoría vence el <strong>${esc(day)}</strong>. ${expiringNote}</p>`;
    }

    // ── Resumen para Manu (un mail por alumno) ──
    const parts: string[] = [];
    if (lapsed.length) parts.push("quedó sin acceso");
    if (expiring.length) parts.push("la mentoría vence pronto");
    if (tracks.length) parts.push(`${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`);
    if (tasks.length) parts.push(`${tasks.length} ${tasks.length === 1 ? "misión completada" : "misiones completadas"}`);
    const subject = `Frequency Lab — ${name}: ${parts.join(" · ")}`;

    const trackRows = tracks.map((e) => {
      const url = String(e.payload?.url || "");
      const safe = url.startsWith("https://") ? url : "";
      return `<li style="margin:0 0 8px">♪ <strong>${esc(e.payload?.title)}</strong>${safe ? ` — <a href="${esc(safe)}">${esc(safe)}</a>` : ""}</li>`;
    }).join("");
    const taskRows = tasks.map((e) =>
      `<li style="margin:0 0 8px">✓ ${esc(findTaskText(dash?.content, e.ref_id) || "Misión (ya no está en Notion)")}</li>`
    ).join("");

    const html = WRAP(`
      <p style="margin:0 0 4px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.6">Frequency Lab</p>
      <h2 style="font-weight:600;margin:0 0 16px">Novedades de ${esc(name)}</h2>
      ${lapsed.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Sin acceso</h3><p><strong>${esc(name)} quedó sin acceso por falta de pago.</strong> Pasaron los 5 días de gracia.</p>` : ""}
      ${expiring.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Vence pronto</h3>${expiringNote}` : ""}
      ${tracks.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Subió ${tracks.length === 1 ? "un track" : "tracks"}</h3><ul style="padding-left:18px;margin:0">${trackRows}</ul>` : ""}
      ${tasks.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Completó ${tasks.length === 1 ? "una misión" : "misiones"}</h3><ul style="padding-left:18px;margin:0">${taskRows}</ul>` : ""}
      <p style="margin-top:24px;font-size:13px"><a href="https://manupavez.com/admin.html">Abrir el panel de alumnos →</a></p>`);

    // Si el resumen a Manu falla, los eventos quedan pendientes y se reintentan.
    // (El aviso al alumno puede repetirse en ese caso: es preferible a no avisarle.)
    if (!(await send(TO, subject, html))) continue;
    await db.from("lab_events").update({ sent_at: new Date().toISOString() }).in("id", list.map((e) => e.id));
    sent++;
  }

  return json({ ok: true, sent });
});
