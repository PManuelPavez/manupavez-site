// admin.js — Panel mínimo del Lab: alumnos, acceso y sync con Notion.
// El navegador no decide nada: si no sos admin, RLS devuelve vacío y la
// Edge Function responde 401. Esta página solo pinta lo que la base permite.
import { supabase, hasSupabase } from "../data/supabaseClient.js";
import {
  isAdmin, adminListStudents, adminUpdateStudent, adminSetMembership,
  adminLastSync, adminRunSync, membershipIsActive,
} from "../data/lab.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (d) => (d ? new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");
const fmtDateOnly = (d) => {
  if (!d) return "—";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const msg = $("[data-admin-msg]");
const rowsEl = $("[data-admin-rows]");
const tableWrap = $("[data-admin-table]");
const actions = $("[data-admin-actions]");
const syncBtn = $("[data-sync]");
const syncStatus = $("[data-sync-status]");

function say(text, isError = false) {
  msg.textContent = text;
  msg.classList.toggle("is-error", isError);
  msg.hidden = !text;
}

function accessLabel(st) {
  const m = st.membership;
  if (st.status !== "active") return { text: "Inactivo", cls: "off" };
  if (!st.email) return { text: "Sin email", cls: "off" };
  if (membershipIsActive(m)) return { text: "Activo", cls: "on" };
  if (m?.status === "active") return { text: "Vencido", cls: "warn" };
  if (m?.status === "past_due") return { text: "Pago pendiente", cls: "warn" };
  return { text: "Revocado", cls: "off" };
}

function renderRow(st) {
  const a = accessLabel(st);
  const last = st.sessions.last;
  const active = membershipIsActive(st.membership);
  return `
    <tr data-id="${esc(st.id)}">
      <th scope="row">${esc(st.full_name)}<small>${st.sessions.count} sesiones</small></th>
      <td>
        <form class="admin-email" data-email-form>
          <input type="email" value="${esc(st.email || "")}" placeholder="email@alumno.com" aria-label="Email de ${esc(st.full_name)}" required />
          <button type="submit" class="mp-btn ghost small">GUARDAR</button>
        </form>
        ${st.email ? `<small>${st.user_id ? "Ya ingresó" : "Nunca ingresó"}</small>` : ""}
      </td>
      <td><span class="admin-pill admin-pill--${a.cls}">${a.text}</span></td>
      <td>${fmt(st.membership?.current_period_end)}</td>
      <td>${last ? `Sesión ${esc(last.number)} · ${fmtDateOnly(last.session_date)}` : "—"}</td>
      <td class="admin-actions">
        <button type="button" class="mp-btn primary small" data-act="extend">${active ? "+30 DÍAS" : "ACTIVAR 30 DÍAS"}</button>
        ${active ? `<button type="button" class="mp-btn ghost small" data-act="revoke">REVOCAR</button>` : ""}
      </td>
    </tr>`;
}

let students = [];

async function loadStudents() {
  students = await adminListStudents();
  rowsEl.innerHTML = students.length
    ? students.map(renderRow).join("")
    : `<tr><td colspan="6">Todavía no hay alumnos. Corré la sincronización con Notion.</td></tr>`;
  tableWrap.hidden = false;
}

async function loadSync() {
  const run = await adminLastSync();
  if (!run) { syncStatus.textContent = "Sin sincronizaciones todavía"; return; }
  const when = new Date(run.started_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  if (!run.finished_at) syncStatus.textContent = `Sincronizando… (${when})`;
  else if (run.ok) syncStatus.textContent = `Último sync ${when} · ${run.stats?.sessions_updated ?? 0} actualizadas${run.stats?.partial ? " (parcial)" : ""}`;
  else syncStatus.textContent = `Último sync ${when} falló: ${run.error || "error"}`;
}

function addDays(base, days) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

rowsEl.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.closest("tr")?.dataset.id;
  const st = students.find((s) => s.id === id);
  if (!st) return;

  btn.disabled = true;
  try {
    if (btn.dataset.act === "extend") {
      if (!st.email) throw new Error("Primero cargá el email del alumno.");
      // Si sigue vigente, suma 30 días al vencimiento actual; si no, desde hoy
      const cur = st.membership?.current_period_end;
      const base = cur && new Date(cur) > new Date() && st.membership?.status === "active" ? cur : new Date();
      await adminSetMembership(id, { status: "active", current_period_end: addDays(base, 30) });
      say(`${st.full_name}: acceso activo hasta ${fmt(addDays(base, 30))}.`);
    } else if (btn.dataset.act === "revoke") {
      if (!confirm(`¿Revocar el acceso de ${st.full_name}? Deja de ver sus sesiones y el material al instante.`)) return;
      await adminSetMembership(id, { status: "revoked", current_period_end: st.membership?.current_period_end ?? null });
      say(`${st.full_name}: acceso revocado.`);
    }
    await loadStudents();
  } catch (err) {
    say(err.message || "No se pudo guardar.", true);
  } finally {
    btn.disabled = false;
  }
});

rowsEl.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-email-form]");
  if (!form) return;
  e.preventDefault();
  const id = form.closest("tr")?.dataset.id;
  const email = form.querySelector("input").value.trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) { say("Email inválido.", true); return; }
  try {
    await adminUpdateStudent(id, { email: email || null });
    say("Email guardado. Ya puede pedir su link en el área de alumnos (si su acceso está activo).");
    await loadStudents();
  } catch (err) {
    say(err.code === "23505" ? "Ese email ya está asignado a otro alumno." : (err.message || "No se pudo guardar."), true);
  }
});

syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  syncStatus.textContent = "Sincronizando con Notion… (puede tardar un minuto)";
  try {
    const res = await adminRunSync();
    say(`Sync OK: ${res.stats.students} alumnos, ${res.stats.sessions_updated} sesiones actualizadas.`);
    await loadStudents();
  } catch (err) {
    const known = {
      missing_notion_token: "Falta cargar NOTION_TOKEN en los secretos de Supabase.",
      already_running: "Ya hay una sincronización en curso.",
      unauthorized: "Tu sesión no tiene permisos de admin.",
    };
    say(known[err.message] || "La sincronización falló. Mirá el detalle arriba.", true);
  } finally {
    syncBtn.disabled = false;
    loadSync().catch(() => {});
  }
});

async function boot() {
  if (!hasSupabase() || !supabase) { say("Supabase no configurado.", true); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    msg.innerHTML = `Iniciá sesión primero en el <a href="clinicas.html#alumnos">área de alumnos</a> y volvé acá.`;
    return;
  }
  if (!(await isAdmin())) { say("Esta cuenta no tiene acceso al panel.", true); return; }

  say("");
  actions.hidden = false;
  await Promise.all([loadStudents(), loadSync().catch(() => {})]);
}

boot().catch((err) => {
  console.error("[admin]", err);
  say("No se pudo cargar el panel.", true);
});
