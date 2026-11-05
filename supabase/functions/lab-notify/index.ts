// supabase/functions/lab-notify/index.ts
// Avisos por mail (Resend) a partir de lab_events. La llama pg_cron cada 5 min,
// solo si hay novedades pendientes. Agrupa todo en UN mail por alumno para Manu.
//
//  · track_added / task_done   → mail a Manu (novedades del alumno)
//  · membership_expiring        → mail AL ALUMNO con el link para renovar + resumen a Manu
//  · membership_lapsed          → mail a Manu: "{alumno} quedó sin acceso por falta de pago"
//  · notion_updated             → mail AL ALUMNO «Actualicé tu portal» (uno solo por corrida, junta las notas)
//  · membership_paid            → mail AL ALUMNO «Bienvenido» (primer mes) o «Mes N confirmado»
//
// El mail al alumno se registra aparte (student_sent_at): si falla el resumen a Manu, no se repite.
// Si falla el mail al alumno se guarda student_error y se reintenta (hasta 6 veces, dentro de 3 días),
// aunque el resumen a Manu ya haya salido.
//
// Mail al alumno: necesita un remitente con dominio verificado en Resend (LAB_FROM_EMAIL).
// Con el remitente de prueba (onboarding@resend.dev) Resend solo entrega a la casilla
// del dueño de la cuenta: en ese caso el resumen a Manu lo aclara.
//
// Secretos: RESEND_API_KEY (ya existe). Opcionales: LAB_FROM_EMAIL, LAB_TO_EMAIL.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { membershipPaidMail, notionUpdatedMail, planLabel } from "../_shared/lab-mails.ts";

const REPLY_TO = "manupavez22@gmail.com";
const STUDENT_KINDS = ["notion_updated", "membership_paid", "membership_expiring"];
const MAX_ATTEMPTS = 6;

// Remitente: LAB_FROM_EMAIL; si no está, el dominio verificado de los mails de entradas
// (TICKETS_FROM_EMAIL) con "lab@"; último recurso, el de prueba de Resend.
function labFrom() {
  const lab = Deno.env.get("LAB_FROM_EMAIL");
  if (lab) return lab;
  const tickets = Deno.env.get("TICKETS_FROM_EMAIL") || "";
  const domain = (tickets.match(/@([^>\s]+)/) || [])[1];
  return domain ? `Frequency Lab <lab@${domain}>` : "Frequency Lab <onboarding@resend.dev>";
}

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
const argDayFull = (iso: string) =>
  new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" });

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

// Secciones con 2+ misiones que quedaron TODAS cumplidas (Notion o tilde del alumno)
// y que tocó alguna de las misiones de este lote → para festejarlo en el mail.
function completedSections(content: any, checks: Map<string, boolean>, touched: Set<string>): string[] {
  const out: string[] = [];
  for (const row of content?.rows || []) {
    for (const col of row.cols || []) {
      for (const sec of col || []) {
        const tasks = (sec.items || []).filter((i: any) => i.t === "task" && i.id);
        if (tasks.length < 2 || !tasks.some((t: any) => touched.has(t.id))) continue;
        if (tasks.every((t: any) => t.done || checks.get(t.id) === true)) {
          out.push(String(sec.title || "Misiones").replace(/\s*\.$/, ""));
        }
      }
    }
  }
  return out;
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
  const FROM = labFrom();
  const TO = (Deno.env.get("LAB_TO_EMAIL") || "manupavez22@gmail.com").split(",").map((s) => s.trim()).filter(Boolean);

  // Devuelve null si salió bien, o el motivo del error
  const sendRaw = async (to: string[], subject: string, html: string, replyTo?: string): Promise<string | null> => {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      if (res.ok) return null;
      const txt = (await res.text().catch(() => "")).slice(0, 200);
      console.error("[lab-notify] resend", res.status, txt);
      return `resend ${res.status}: ${txt}`.slice(0, 300);
    } catch (e) {
      return `fetch: ${(e as Error).message}`.slice(0, 300);
    }
  };
  const send = async (to: string[], subject: string, html: string, replyTo?: string) =>
    (await sendRaw(to, subject, html, replyTo)) === null;

  // Mail al alumno para un grupo de eventos. Marca student_sent_at o student_error en esos eventos.
  // Devuelve "sent" | "no_email" | "failed".
  const sendToStudent = async (evs: any[], email: string | null, subject: string, html: string) => {
    const ids = evs.map((e) => e.id);
    if (!email) {
      await db.from("lab_events").update({ student_error: "sin_email" }).in("id", ids);
      return "no_email";
    }
    const err = await sendRaw([email], subject, html, REPLY_TO);
    if (err === null) {
      const now = new Date().toISOString();
      await db.from("lab_events").update({ student_sent_at: now, student_error: null }).in("id", ids);
      for (const e of evs) e.student_sent_at = now;
      return "sent";
    }
    for (const e of evs) {
      await db.from("lab_events").update({ student_error: err, student_attempts: (e.student_attempts || 0) + 1 }).eq("id", e.id);
    }
    return "failed";
  };

  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString();
  const retrySince = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const { data: events, error } = await db
    .from("lab_events")
    .select("id, student_id, kind, ref_id, payload, created_at, sent_at, student_sent_at, student_error, student_attempts, students(full_name, email)")
    .lt("created_at", cutoff)
    .or(
      `sent_at.is.null,and(kind.in.(${STUDENT_KINDS.join(",")}),student_sent_at.is.null,student_error.not.is.null,` +
        `student_error.neq.sin_email,student_attempts.lt.${MAX_ATTEMPTS},created_at.gt.${retrySince})`,
    )
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

    // Eventos que todavía no entraron en un resumen a Manu (los otros solo reintentan el mail al alumno)
    const fresh = list.filter((e) => !e.sent_at);
    const pendingStudent = (e: any) => !e.student_sent_at && e.student_error !== "sin_email";

    const tracks = fresh.filter((e) => e.kind === "track_added");
    const tasks = fresh.filter((e) => e.kind === "task_done");
    const lapsed = fresh.filter((e) => e.kind === "membership_lapsed");
    const expiringAll = list.filter((e) => e.kind === "membership_expiring");
    const portalAll = list.filter((e) => e.kind === "notion_updated");
    const paidAll = list.filter((e) => e.kind === "membership_paid");

    // ── Mail al alumno: aviso de portal (uno solo, con todas las notas) ──
    let portalState = "";
    const portalPending = portalAll.filter(pendingStudent);
    const portalNotes = portalPending.map((e) => String(e.payload?.note || "").trim()).filter(Boolean);
    if (portalPending.length) {
      const m = notionUpdatedMail({ fullName: student.full_name || "", note: portalNotes.join("\n\n") });
      portalState = await sendToStudent(portalPending, studentEmail, m.subject, m.html);
    } else if (portalAll.length) {
      portalState = portalAll.some((e) => e.student_error === "sin_email") ? "no_email" : "sent";
    }

    // ── Mail al alumno: mes confirmado (uno por orden) ──
    const paidStates = new Map<number, string>();
    for (const e of paidAll) {
      if (!pendingStudent(e)) {
        paidStates.set(e.id, e.student_error === "sin_email" ? "no_email" : "sent");
        continue;
      }
      const p = e.payload || {};
      const m = membershipPaidMail({
        fullName: student.full_name || "",
        first: p.first === true,
        month: Number(p.month) || undefined,
        until: String(p.until || ""),
        productSlug: p.product_slug || undefined,
        productName: p.product_name || undefined,
      });
      paidStates.set(e.id, await sendToStudent([e], studentEmail, m.subject, m.html));
    }

    // ── Mail al alumno: su mentoría vence pronto ──
    let expiringNote = "";
    const expiringPending = expiringAll.filter(pendingStudent);
    const expiringRef = expiringAll[expiringAll.length - 1];
    const expDay = expiringRef?.payload?.until ? argDay(String(expiringRef.payload.until)) : "";
    let expiringState = "";
    if (expiringPending.length) {
      expiringState = await sendToStudent(
        expiringPending,
        studentEmail,
        `Tu mentoría de Frequency Lab vence el ${expDay}`,
        WRAP(`
          <p style="margin:0 0 4px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;opacity:.6">Frequency Lab</p>
          <h2 style="font-weight:600;margin:0 0 16px">Hola ${esc(firstName(student.full_name || ""))}</h2>
          <p>Tu mentoría vence el <strong>${esc(expDay)}</strong>. Para seguir sin cortes con tus sesiones y tu espacio, renovala acá:</p>
          <p style="margin:20px 0"><a href="${SHOP_URL}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#0a0a0a;color:#fff;text-decoration:none">Renovar mi mentoría</a></p>
          <p style="font-size:13px;opacity:.7">Si ya la pagaste por transferencia, ignorá este mensaje. Cualquier duda, respondé este mail.</p>`),
      );
    } else if (expiringAll.length) {
      expiringState = expiringAll.some((e) => e.student_error === "sin_email") ? "no_email" : "sent";
    }

    // Solo reintentos de mails al alumno: no hay resumen nuevo para Manu
    if (!fresh.length) continue;

    const freshKinds = new Set(fresh.map((e) => e.kind));
    const expiring = freshKinds.has("membership_expiring");
    const portal = freshKinds.has("notion_updated");
    const paidFresh = paidAll.filter((e) => !e.sent_at);

    const needsDash = tasks.length > 0;
    const { data: dash } = needsDash
      ? await db.from("student_dashboards").select("content").eq("student_id", studentId).maybeSingle()
      : { data: null };
    let allDone: string[] = [];
    if (needsDash) {
      const { data: checkRows } = await db.from("student_task_checks").select("task_key, done").eq("student_id", studentId);
      const checks = new Map((checkRows || []).map((c: any) => [c.task_key, c.done === true]));
      allDone = completedSections(dash?.content, checks, new Set(tasks.map((e) => String(e.ref_id))));
    }

    const failNote = `⚠ No se pudo mandar (se reintenta solo). Si sigue fallando, revisá el remitente en Resend.`;
    if (expiring) {
      expiringNote = expiringState === "no_email"
        ? `No le llegó el aviso: <strong>no tiene mail cargado</strong> en el panel. Avisale vos para que renueve.`
        : expiringState === "failed"
          ? failNote
          : `Le avisamos a ${esc(name)} (${esc(studentEmail)}) que vence el ${esc(expDay)}, con el link para renovar.`;
      expiringNote = `<p>Su mentoría vence el <strong>${esc(expDay)}</strong>. ${expiringNote}</p>`;
    }

    let portalNote = "";
    if (portal) {
      const notes = portalAll.filter((e) => !e.sent_at).map((e) => String(e.payload?.note || "").trim()).filter(Boolean);
      portalNote = portalState === "no_email"
        ? `<p>⚠ No le llegó el aviso de portal: <strong>no tiene mail cargado</strong> en el panel.</p>`
        : portalState === "failed"
          ? `<p>📬 Aviso de portal: ${failNote}</p>`
          : `<p>📬 Aviso de portal enviado a ${esc(studentEmail)}.</p>`;
      if (notes.length) portalNote += `<ul style="padding-left:18px;margin:0">${notes.map((n) => `<li style="margin:0 0 6px;white-space:pre-line">${esc(n)}</li>`).join("")}</ul>`;
    }

    const paidNote = paidFresh.map((e) => {
      const p = e.payload || {};
      const plan = planLabel(p.product_slug, p.product_name);
      const which = p.first === true ? "primer mes" : Number(p.month) > 1 ? `mes ${Number(p.month)}` : "renovación";
      const st = paidStates.get(e.id);
      const mail = st === "no_email"
        ? `⚠ No le llegó el mail: <strong>no tiene mail cargado</strong>.`
        : st === "failed" ? failNote : `Le llegó el mail a ${esc(studentEmail)}.`;
      return `<p>✅ Mes confirmado: <strong>${esc(plan)}</strong> hasta ${esc(p.until ? argDayFull(String(p.until)) : "—")} (${esc(which)}). ${mail}</p>`;
    }).join("");

    // ── Resumen para Manu (un mail por alumno) ──
    const parts: string[] = [];
    if (paidFresh.length) parts.push("✅ mes confirmado");
    if (lapsed.length) parts.push("quedó sin acceso");
    if (expiring) parts.push("la mentoría vence pronto");
    if (portal) parts.push(portalState === "no_email" ? "aviso de portal sin mail" : "📬 aviso de portal");
    if (tracks.length) parts.push(`${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`);
    if (allDone.length) parts.push("🎉 cumplió todas sus misiones");
    else if (tasks.length) parts.push(`${tasks.length} ${tasks.length === 1 ? "misión completada" : "misiones completadas"}`);
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
      ${paidFresh.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Pago</h3>${paidNote}` : ""}
      ${lapsed.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Sin acceso</h3><p><strong>${esc(name)} quedó sin acceso por falta de pago.</strong> Pasaron los 5 días de gracia.</p>` : ""}
      ${expiring ? `<h3 style="font-size:14px;margin:18px 0 8px">Vence pronto</h3>${expiringNote}` : ""}
      ${portal ? `<h3 style="font-size:14px;margin:18px 0 8px">Portal</h3>${portalNote}` : ""}
      ${tracks.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Subió ${tracks.length === 1 ? "un track" : "tracks"}</h3><ul style="padding-left:18px;margin:0">${trackRows}</ul>` : ""}
      ${allDone.length ? `<p style="margin:18px 0 0;padding:12px 14px;border-radius:10px;background:#e9f7f5"><strong>🎉 Cumplió todas las misiones</strong> de ${allDone.map((t) => `«${esc(t)}»`).join(", ")}. Buen momento para darle la próxima tanda.</p>` : ""}
      ${tasks.length ? `<h3 style="font-size:14px;margin:18px 0 8px">Completó ${tasks.length === 1 ? "una misión" : "misiones"}</h3><ul style="padding-left:18px;margin:0">${taskRows}</ul>` : ""}
      <p style="margin-top:24px;font-size:13px"><a href="https://manupavez.com/admin.html">Abrir el panel de alumnos →</a></p>`);

    // Si el resumen a Manu falla, los eventos quedan pendientes y se reintentan.
    // El mail al alumno no se repite: ya quedó marcado en student_sent_at.
    if (!(await send(TO, subject, html))) continue;
    await db.from("lab_events").update({ sent_at: new Date().toISOString() }).in("id", fresh.map((e) => e.id));
    sent++;
  }

  return json({ ok: true, sent });
});
