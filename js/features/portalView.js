// portalView.js — Dibuja la página del alumno como espejo de su Notion:
// filas → columnas → secciones (tarjetas). Todo el texto viene de Notion,
// así que se escapa siempre y los links pasan por safeHref.

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Solo http(s): evita javascript: y similares aunque el dato venga de Notion
export function safeHref(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return y && m && day ? `${day}/${m}/${y}` : "";
};

const COLORS = new Set(["blue", "red", "green", "orange", "yellow", "brown", "purple", "pink", "gray"]);
const cleanTitle = (t) => String(t || "").replace(/\s*\.$/, "");
export const displayName = (fullName) =>
  String(fullName || "").replace(/\s*[-–]\s*frequency\s*lab\.?\s*$/i, "").trim();

// "Efectos: Aprender el uso…" → negrita en la etiqueta corta antes de ":"
function emphasize(s) {
  const m = String(s).match(/^([^:]{2,40}):\s+(.+)$/);
  return m ? `<strong>${esc(m[1])}:</strong> ${esc(m[2])}` : esc(s);
}

// Notas de la sesión (texto plano del sync) → títulos, párrafos y listas
function renderNotes(text) {
  let html = "";
  let list = [];
  const flush = () => {
    if (list.length) html += `<ul class="portal-notes__list">${list.join("")}</ul>`;
    list = [];
  };
  for (const raw of String(text).split("\n")) {
    if (!raw.trim()) continue;
    const bullet = raw.match(/^(\s*)• (.*)$/);
    if (bullet) {
      const depth = Math.min(3, Math.floor(bullet[1].length / 2));
      list.push(`<li data-depth="${depth}">${emphasize(bullet[2])}</li>`);
      continue;
    }
    flush();
    const t = raw.trim();
    const isUpperTitle = t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(t) && t.length < 80;
    const isShortTitle = t.length <= 48 && !/[.,;:!?)]$/.test(t);
    html += isUpperTitle || isShortTitle ? `<h5>${esc(t)}</h5>` : `<p>${emphasize(t)}</p>`;
  }
  flush();
  return html;
}

// Los "grupos" (líneas que terminan en ":") son subtítulos; el resto, pasos
function renderTask(t) {
  const depth = Math.max(0, Math.min(3, Number(t.depth) || 0));
  if (t.group) return `<li class="is-group" data-depth="${depth}">${esc(t.text)}</li>`;
  return `<li class="${t.done ? "is-done" : ""}" data-depth="${depth}"><span aria-hidden="true">${t.done ? "✓" : "→"}</span> ${esc(t.text)}</li>`;
}

function sessionSubtitle(title) {
  return String(title || "")
    .replace(/SESI[OÓ]N\s*\d+\s*[-–:]?\s*/i, "")
    .replace(/^\((.*)\)$/, "$1")
    .trim();
}

function renderSession(s, i) {
  const tasks = Array.isArray(s.tasks) ? s.tasks : [];
  const links = (Array.isArray(s.links) ? s.links : [])
    .map((l) => ({ href: safeHref(l.url), label: l.label || "Ver grabación" }))
    .filter((l) => l.href);
  const date = fmtDate(s.session_date);
  const sub = sessionSubtitle(s.title);
  const empty = !s.notes && !tasks.length && !links.length;

  return `
    <details class="portal-session"${i === 0 ? " open" : ""}>
      <summary>
        <span class="portal-session__num">Sesión ${esc(s.number ?? "")}</span>
        ${sub ? `<span class="portal-session__sub">${esc(sub)}</span>` : ""}
        ${date ? `<span class="portal-session__date">${esc(date)}</span>` : ""}
      </summary>
      <div class="portal-session__body">
        ${links.length ? `
          <div class="portal-links">
            ${links.map((l) => `<a class="mp-btn ghost small" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join("")}
          </div>` : ""}
        ${s.notes ? `<div class="portal-notes">${renderNotes(s.notes)}</div>` : ""}
        ${tasks.length ? `
          <div class="portal-nextsteps">
            <h5>Próximos pasos</h5>
            <ul class="portal-tasks">${tasks.map(renderTask).join("")}</ul>
          </div>` : ""}
        ${empty ? `<p class="muted">Esta sesión todavía no tiene resumen cargado.</p>` : ""}
      </div>
    </details>`;
}

function renderSessions(sessions) {
  return sessions.length
    ? `<div class="portal-sessions">${sessions.map(renderSession).join("")}</div>`
    : `<p class="muted">Todavía no hay sesiones cargadas. Aparecen acá después de cada encuentro.</p>`;
}

function renderLink(l) {
  const href = safeHref(l.url);
  if (!href) return "";
  const host = new URL(href).hostname.replace(/^www\./, "");
  const recording = l.kind === "recording";
  return `
    <a class="portal-linkcard" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
      <span class="portal-linkcard__icon" aria-hidden="true">${recording ? "▶" : "↗"}</span>
      <span class="portal-linkcard__body">
        <strong>${esc(l.label || host)}</strong>
        <small>${esc(host)}${recording ? " · Ver grabación" : ""}</small>
      </span>
    </a>`;
}

// Agrupa ítems consecutivos del mismo tipo (bullets → <ul>, tareas → checklist…)
// ctx = { sessions, tracks, checks: Map(task_key → done) }
function renderTaskItem(g, checks, readOnly = false) {
  const byNotion = Boolean(g.done);
  const done = byNotion || checks?.get(g.id) === true;
  const depth = Math.min(3, g.depth || 0);
  const box = g.id
    ? `<button type="button" class="portal-check" role="checkbox" aria-checked="${done}" data-task-key="${esc(g.id)}"
         aria-label="${esc(g.text)}"${byNotion ? ' disabled title="Marcada por Manu en Notion"' : readOnly ? " disabled" : ""}>${done ? "✓" : ""}</button>`
    : `<span class="portal-check" aria-hidden="true">${done ? "✓" : ""}</span>`;
  return `<li class="${done ? "is-done" : ""}" data-depth="${depth}">${box}<span>${esc(g.text)}</span></li>`;
}

function renderItems(items, ctx) {
  let html = "";
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.t === "bullet" || it.t === "task" || it.t === "link") {
      const group = [];
      while (i < items.length && items[i].t === it.t) group.push(items[i++]);
      if (it.t === "bullet") {
        html += `<ul class="portal-list">${group.map((g) => `<li data-depth="${Math.min(3, g.depth || 0)}">${emphasize(g.text)}</li>`).join("")}</ul>`;
      } else if (it.t === "task") {
        html += `<ul class="portal-checklist">${group.map((g) => renderTaskItem(g, ctx.checks, ctx.readOnly)).join("")}</ul>`;
      } else {
        html += `<div class="portal-linkgrid">${group.map(renderLink).join("")}</div>`;
      }
      continue;
    }
    if (it.t === "label") html += `<p class="portal-label">${esc(it.text)}</p>`;
    else if (it.t === "text") html += `<p class="portal-text">${emphasize(it.text)}</p>`;
    else if (it.t === "sessions") html += renderSessions(ctx.sessions);
    i++;
  }
  return html;
}

// ── Tracks del alumno (los carga él mismo en "Work in progress") ──
const isWipTitle = (t) => /work\s*in\s*progress/i.test(String(t || ""));

function renderTrack(t, readOnly = false) {
  const href = safeHref(t.url);
  if (!href) return "";
  const host = new URL(href).hostname.replace(/^www\./, "");
  return `
    <div class="portal-track" data-track-id="${esc(t.id)}">
      <a class="portal-linkcard" href="${esc(href)}" target="_blank" rel="noopener noreferrer">
        <span class="portal-linkcard__icon" aria-hidden="true">♪</span>
        <span class="portal-linkcard__body">
          <strong>${esc(t.title)}</strong>
          <small>${esc(host)} · ${esc(fmtDate(t.created_at))}</small>
        </span>
      </a>
      ${readOnly ? "" : `<button type="button" class="portal-track__del" data-track-del aria-label="Borrar ${esc(t.title)}">×</button>`}
    </div>`;
}

export function renderTrackList(tracks, readOnly = false) {
  return tracks.length
    ? tracks.map((t) => renderTrack(t, readOnly)).join("")
    : `<p class="portal-tracks__empty">Todavía no subiste tracks. Sumá el link de lo que estés trabajando.</p>`;
}

function renderTracksBlock(tracks, readOnly = false) {
  if (readOnly) {
    return `
    <div class="portal-tracks">
      <p class="portal-label">Sus tracks</p>
      <div class="portal-linkgrid">${renderTrackList(tracks, true)}</div>
    </div>`;
  }
  return `
    <div class="portal-tracks" data-tracks>
      <p class="portal-label">Tus tracks</p>
      <div class="portal-linkgrid" data-track-list>${renderTrackList(tracks)}</div>
      <button type="button" class="mp-btn ghost small portal-tracks__add" data-track-add>+ ADD TRACK</button>
      <form class="portal-trackform" data-track-form hidden novalidate>
        <label>
          <span>Título</span>
          <input name="title" type="text" maxlength="120" required autocomplete="off" placeholder="Ej: Track 1 — idea del drop" />
        </label>
        <label>
          <span>Link</span>
          <input name="url" type="url" inputmode="url" maxlength="500" required autocomplete="off" placeholder="https://soundcloud.com/…" />
        </label>
        <p class="portal-trackform__note" data-track-note role="status" aria-live="polite"></p>
        <div class="portal-trackform__actions">
          <button type="submit" class="mp-btn primary small">GUARDAR</button>
          <button type="button" class="mp-btn ghost small" data-track-cancel>CANCELAR</button>
        </div>
      </form>
    </div>`;
}

function renderSection(sec, ctx) {
  const color = COLORS.has(sec.color) ? sec.color : "none";
  return `
    <section class="portal-card" data-color="${color}">
      ${sec.title ? `<h4 class="portal-card__title">${esc(cleanTitle(sec.title))}</h4>` : ""}
      ${renderItems(sec.items || [], ctx)}
      ${sec.wip ? renderTracksBlock(ctx.tracks, ctx.readOnly) : ""}
    </section>`;
}

/**
 * @param {{ student, dashboard, sessions, material, adminLink, renderMaterialItem }} data
 */
export function renderPortal({ student, dashboard, sessions, tracks = [], checks = new Map(), material, adminLink, renderMaterialItem, readOnly = false }) {
  const ctx = { sessions, tracks, checks, readOnly };
  // Copia: marcamos la sección "Work in progress" (la primera) para sumarle los tracks
  let rows = (dashboard?.rows || []).map((r) => ({ cols: r.cols.map((c) => c.map((s) => ({ ...s }))) }));
  const wip = rows.flatMap((r) => r.cols.flat()).find((s) => isWipTitle(s.title));
  if (wip) wip.wip = true;
  else rows = [...rows, { cols: [[{ title: "Work in progress", color: "blue", items: [], wip: true }]] }];
  const hasSessionsSlot = rows.some((r) => r.cols.some((c) => c.some((s) => s.items?.some((it) => it.t === "sessions"))));
  // Sin espejo de Notion todavía, o sin lugar para las sesiones: se agregan al final
  if (!hasSessionsSlot) rows = [...rows, { cols: [[{ title: "Resumen de sesiones", color: null, items: [{ t: "sessions" }] }]] }];
  if (material?.length) {
    rows = [...rows, { cols: [[{ title: "Material del Lab", color: null, items: [] , material: true }]] }];
  }

  const m = student.membership;
  const until = m?.current_period_end;
  const isActive = m?.status === "active" && (!until || new Date(until) > new Date());
  const meta = !isActive ? "Acceso pausado" : until ? `Acceso activo hasta ${fmtDate(until)}` : "Acceso activo";

  return `
    <div class="portal">
      <header class="portal-head">
        <div>
          <p class="portal-kicker">Tu espacio en Frequency Lab</p>
          <h3 class="portal-name">${esc(displayName(student.full_name))}</h3>
          <p class="portal-meta">${esc(meta)}</p>
        </div>
        ${adminLink || ""}
      </header>
      ${rows.map((r) => `
        <div class="portal-row" data-cols="${Math.min(r.cols.length, 3)}">
          ${r.cols.map((col) => `
            <div class="portal-col">
              ${col.map((sec) => sec.material
                ? `<section class="portal-card" data-color="none"><h4 class="portal-card__title">${esc(sec.title)}</h4>${material.map(renderMaterialItem).join("")}</section>`
                : renderSection(sec, ctx)).join("")}
            </div>`).join("")}
        </div>`).join("")}
    </div>`;
}
