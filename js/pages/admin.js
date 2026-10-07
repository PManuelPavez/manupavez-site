// admin.js — Panel del Lab: alumnos (acceso, PIN, seguimiento), sync con Notion,
// shop (precios, links de pago con precio especial) y pedidos.
// El navegador no decide nada: si no sos admin, RLS devuelve vacío y la
// Edge Function responde 401. Esta página solo pinta lo que la base permite.
import { supabase, hasSupabase } from "../data/supabaseClient.js";
import {
  isAdmin, adminListStudents, adminUpdateStudent, adminSetMembership,
  adminLastSync, adminRunSync, membershipIsActive,
  adminSetStudentPin, adminClearStudentPin, adminSetMyPin, adminPinOverview,
  adminListProducts, adminUpdateProduct, adminSaveProduct, adminListOrders, adminCreatePaymentLink,
  adminMarkOrderPaid, adminSetSessionDate,
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
// Los links los cargan los alumnos: solo https, siempre escapados
const safeHref = (u) => { try { const x = new URL(u); return x.protocol === "https:" ? x.href : ""; } catch { return ""; } };

// Días desde una fecha (aaaa-mm-dd) hasta hoy, en Argentina
function daysSince(isoDate) {
  if (!isoDate) return null;
  const today = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  return Math.round((Date.parse(today) - Date.parse(String(isoDate).slice(0, 10))) / 86400_000);
}
const agoLabel = (n) => (n == null ? "" : n <= 0 ? "hoy" : n === 1 ? "hace 1 día" : `hace ${n} días`);

// Detalles abiertos (sesiones) que sobreviven a la recarga de la tabla
const openSessions = new Set();

function renderSessions(st) {
  const list = st.sessions.list || [];
  if (!list.length) return "";
  return `
    <details class="admin-sessions" data-sessions-of="${esc(st.id)}"${openSessions.has(st.id) ? " open" : ""}>
      <summary>Ver sesiones (${list.length})</summary>
      <ul>${list.map((s) => `
        <li data-session-id="${esc(s.id)}">
          <span class="admin-sessions__num">Sesión ${esc(s.number ?? "")}</span>
          <form class="admin-sessions__form" data-session-date-form>
            <input type="date" value="${esc(s.date || "")}" aria-label="Fecha de la sesión ${esc(s.number ?? "")}" />
            <button type="submit" class="mp-btn ghost small">GUARDAR</button>
          </form>
          <small>${s.session_date_manual
            ? `Fecha cargada a mano · <button type="button" class="admin-linkbtn" data-act="clear-session-date" data-session="${esc(s.id)}">usar la de Notion${s.session_date ? ` (${fmtDateOnly(s.session_date)})` : ""}</button>`
            : s.session_date ? "Fecha automática (de Notion)" : "Sin fecha"}</small>
        </li>`).join("")}</ul>
    </details>`;
}

function renderTracks(tracks) {
  if (!tracks.length) return "";
  return `
    <details class="admin-tracks">
      <summary>Ver tracks</summary>
      <ul>${tracks.map((t) => {
        const href = safeHref(t.url);
        return `<li>${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(t.title)}</a>` : esc(t.title)} <span>${fmt(t.created_at)}</span></li>`;
      }).join("")}</ul>
    </details>`;
}

const msg = $("[data-admin-msg]");
const rowsEl = $("[data-admin-rows]");
const tableWrap = $("[data-admin-table]");
const actions = $("[data-admin-actions]");
const syncBtn = $("[data-sync]");
const syncStatus = $("[data-sync-status]");
const pinbar = $("[data-admin-pinbar]");
const myPinForm = $("[data-my-pin-form]");
const myPinState = $("[data-my-pin-state]");
const pinSecurity = $("[data-pin-security]");

let pinInfo = { students_with_pin: [], admin_pin: false, failures_1h: 0, global_locked: false };

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
  const hasPin = pinInfo.students_with_pin.includes(st.id);
  return `
    <tr data-id="${esc(st.id)}">
      <th scope="row">${esc(st.full_name)}
        <small>${st.sessions.count} sesiones · ${st.missions.done}/${st.missions.total} misiones · ${st.tracks.length} tracks</small>
        <a class="admin-preview" href="alumnos.html?ver=${esc(st.id)}" target="_blank" rel="noopener">Ver su página →</a>
        ${renderSessions(st)}
        ${renderTracks(st.tracks)}</th>
      <td>
        <form class="admin-email" data-email-form>
          <input type="email" value="${esc(st.email || "")}" placeholder="email@alumno.com" aria-label="Email de ${esc(st.full_name)}" required />
          <button type="submit" class="mp-btn ghost small">GUARDAR</button>
        </form>
        ${st.email ? `<small>${st.user_id ? "Ya ingresó" : "Nunca ingresó"}</small>` : ""}
      </td>
      <td>
        <form class="admin-pin" data-pin-form>
          <input type="password" inputmode="numeric" autocomplete="new-password" maxlength="6" pattern="[0-9]{6}"
            placeholder="${hasPin ? "••••••" : "6 números"}" aria-label="Nuevo PIN de ${esc(st.full_name)}" ${st.email ? "" : "disabled"} />
          <button type="submit" class="mp-btn ghost small" ${st.email ? "" : "disabled"}>${hasPin ? "CAMBIAR" : "ASIGNAR"}</button>
        </form>
        <small>${hasPin ? `PIN asignado · <button type="button" class="admin-linkbtn" data-act="clear-pin">quitar</button>` : st.email ? "Sin PIN" : "Cargá el email primero"}</small>
      </td>
      <td><span class="admin-pill admin-pill--${a.cls}">${a.text}</span></td>
      <td>${fmt(st.membership?.current_period_end)}</td>
      <td>${last ? `Sesión ${esc(last.number)} · ${fmtDateOnly(last.date)}${last.date ? `<small class="${daysSince(last.date) > 14 ? "admin-late" : ""}">${agoLabel(daysSince(last.date))}</small>` : ""}` : "—"}</td>
      <td class="admin-actions">
        ${st.status === "active" ? `
          <button type="button" class="mp-btn primary small" data-act="extend">${active ? "+30 DÍAS" : "ACTIVAR 30 DÍAS"}</button>
          ${active ? `<button type="button" class="mp-btn ghost small" data-act="revoke">REVOCAR</button>` : ""}
          <button type="button" class="admin-linkbtn admin-deactivate" data-act="deactivate">pasar a inactivo</button>`
        : `<button type="button" class="mp-btn ghost small" data-act="reactivate">REACTIVAR</button>`}
      </td>
    </tr>`;
}

let students = [];

// Activos arriba; inactivos en una sección plegada (no se borra nada de ellos)
const inactiveToggle = $("[data-inactive-toggle]");
const inactiveRowsEl = $("[data-admin-inactive]");
const inactiveBtn = $("[data-toggle-inactive]");
let showInactive = false;

function paintInactiveToggle(count) {
  inactiveToggle.hidden = count === 0;
  inactiveRowsEl.hidden = !showInactive || count === 0;
  inactiveBtn.textContent = `${showInactive ? "▾" : "▸"} Inactivos (${count})`;
  inactiveBtn.setAttribute("aria-expanded", String(showInactive));
}
inactiveBtn.addEventListener("click", () => {
  showInactive = !showInactive;
  paintInactiveToggle(inactiveRowsEl.children.length);
});

async function loadStudents() {
  students = await adminListStudents();
  const active = students.filter((s) => s.status === "active");
  const inactive = students.filter((s) => s.status !== "active");
  rowsEl.innerHTML = active.length
    ? active.map(renderRow).join("")
    : `<tr><td colspan="7">${students.length ? "No hay alumnos activos." : "Todavía no hay alumnos. Corré la sincronización con Notion."}</td></tr>`;
  inactiveRowsEl.innerHTML = inactive.map(renderRow).join("");
  paintInactiveToggle(inactive.length);
  tableWrap.hidden = false;
}

async function loadPins() {
  pinInfo = await adminPinOverview();
  myPinState.textContent = pinInfo.admin_pin ? "Asignado" : "Sin asignar";
  pinSecurity.textContent = pinInfo.global_locked
    ? `⚠ Acceso por PIN pausado: ${pinInfo.failures_1h} intentos fallidos en la última hora. Se reactiva solo en menos de 1 hora; mientras tanto, los alumnos entran con su email.`
    : `Intentos fallidos en la última hora: ${pinInfo.failures_1h} de 20 permitidos.`;
  pinSecurity.classList.toggle("is-error", Boolean(pinInfo.global_locked));
}

async function reloadAll() {
  await loadPins().catch(() => {});
  await loadStudents();
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

// Los eventos de las filas se escuchan en toda la tabla (activos e inactivos)
tableWrap.addEventListener("click", async (e) => {
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
    } else if (btn.dataset.act === "reactivate") {
      await adminUpdateStudent(id, { status: "active" });
      say(`${st.full_name}: vuelve a la lista de activos. Si va a tomar clases, activale el acceso.`);
    } else if (btn.dataset.act === "deactivate") {
      await adminUpdateStudent(id, { status: "inactive" });
      say(`${st.full_name}: pasó a inactivos. Sus sesiones e historial quedan guardados.`);
    } else if (btn.dataset.act === "clear-session-date") {
      await adminSetSessionDate(btn.dataset.session, null);
      say(`${st.full_name}: la sesión vuelve a usar la fecha de Notion.`);
    } else if (btn.dataset.act === "clear-pin") {
      if (!confirm(`¿Quitar el PIN de ${st.full_name}? Solo va a poder entrar con su email.`)) return;
      await adminClearStudentPin(id);
      say(`${st.full_name}: PIN quitado.`);
    } else if (btn.dataset.act === "revoke") {
      if (!confirm(`¿Revocar el acceso de ${st.full_name}? Deja de ver sus sesiones y el material al instante.`)) return;
      await adminSetMembership(id, { status: "revoked", current_period_end: st.membership?.current_period_end ?? null });
      say(`${st.full_name}: acceso revocado.`);
    }
    await reloadAll();
  } catch (err) {
    say(err.message || "No se pudo guardar.", true);
  } finally {
    btn.disabled = false;
  }
});

// Recordar qué listas de sesiones están abiertas (la tabla se redibuja al guardar)
tableWrap.addEventListener("toggle", (e) => {
  const d = e.target.closest?.("[data-sessions-of]");
  if (!d) return;
  if (d.open) openSessions.add(d.dataset.sessionsOf);
  else openSessions.delete(d.dataset.sessionsOf);
}, true);

tableWrap.addEventListener("submit", async (e) => {
  const dateForm = e.target.closest("[data-session-date-form]");
  if (dateForm) {
    e.preventDefault();
    const sessionId = dateForm.closest("[data-session-id]")?.dataset.sessionId;
    const value = dateForm.querySelector("input").value; // aaaa-mm-dd o vacío
    const btn = dateForm.querySelector("button");
    btn.disabled = true;
    try {
      await adminSetSessionDate(sessionId, value || null);
      say(value ? `Fecha guardada: ${fmtDateOnly(value)}.` : "Fecha borrada: vuelve a usar la de Notion.");
      await reloadAll();
    } catch (err) {
      say(err.message, true);
    } finally {
      btn.disabled = false;
    }
    return;
  }

  const pinForm = e.target.closest("[data-pin-form]");
  if (pinForm) {
    e.preventDefault();
    const id = pinForm.closest("tr")?.dataset.id;
    const st = students.find((s) => s.id === id);
    const input = pinForm.querySelector("input");
    try {
      await adminSetStudentPin(id, input.value.trim());
      input.value = "";
      say(`PIN guardado para ${st?.full_name || "el alumno"}. Pasáselo en persona: no se puede volver a ver.`);
      await reloadAll();
    } catch (err) {
      say(err.message, true);
    }
    return;
  }

  const form = e.target.closest("[data-email-form]");
  if (!form) return;
  e.preventDefault();
  const id = form.closest("tr")?.dataset.id;
  const email = form.querySelector("input").value.trim().toLowerCase();
  if (email && !EMAIL_RE.test(email)) { say("Email inválido.", true); return; }
  try {
    await adminUpdateStudent(id, { email: email || null });
    say("Email guardado. Ahora podés asignarle un PIN.");
    await reloadAll();
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
    await reloadAll();
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

myPinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = myPinForm.querySelector("input");
  try {
    await adminSetMyPin(input.value.trim());
    input.value = "";
    say("Tu PIN de admin quedó guardado. Con él, el popup de /clinicas te trae directo acá.");
    await loadPins();
  } catch (err) {
    say(err.message, true);
  }
});

// ───────────────────────── Shop ─────────────────────────
const shopEl = $("[data-admin-shop]");
const productsEl = $("[data-products]");
const ordersEl = $("[data-orders]");
const linkForm = $("[data-link-form]");
const linkResult = $("[data-link-result]");
const usd = (n) => `USD ${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const ars = (n) => `$${Math.round(Number(n)).toLocaleString("es-AR")}`;
const STATUS = {
  pending: ["Pendiente", "warn"], paid: ["Pagado", "on"], rejected: ["Rechazado", "off"],
  cancelled: ["Cancelado", "off"], expired: ["Vencido", "off"], refunded: ["Devuelto", "off"],
};
let products = [];
let orders = [];
const METHOD_LABEL = { mercadopago: "MercadoPago", transferencia: "Transferencia", efectivo: "Efectivo", otro: "Otro medio" };

function renderProduct(p) {
  return `
    <tr data-product-id="${esc(p.id)}">
      <th scope="row">${esc(p.name)}<small>${p.kind === "plan" ? "Activa el acceso al Lab 30 días" : "Servicio: te llega un mail para coordinar"}</small>
        <button type="button" class="mp-btn ghost small" data-edit-product>EDITAR</button></th>
      <td>
        <form class="admin-price" data-price-form>
          <input type="number" step="0.01" min="1" max="100000" value="${p.price_usd ?? ""}" aria-label="Precio USD de ${esc(p.name)}" />
          <button type="submit" class="mp-btn ghost small">GUARDAR</button>
        </form>
      </td>
      <td>por ${esc(p.unit)}${p.max_qty > 1 ? ` <small>(hasta ${p.max_qty})</small>` : ""}</td>
      <td><label class="admin-switch"><input type="checkbox" data-active ${p.active ? "checked" : ""} ${p.price_usd ? "" : "disabled"} /> ${p.active && p.price_usd ? "Sí" : "No"}</label></td>
    </tr>`;
}

function renderOrder(o) {
  const [label, cls] = STATUS[o.status] || [o.status, "off"];
  const when = new Date(o.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" });
  const canCopy = o.status === "pending" && o.init_point && new Date(o.expires_at) > new Date();
  return `
    <tr data-order-id="${esc(o.id)}">
      <td>${esc(when)}</td>
      <td>${esc(o.buyer_name)}<small>${esc(o.buyer_email)}</small></td>
      <td>${esc(o.product_name)}${o.source === "admin_link" ? "<small>Precio especial</small>" : ""}${o.note ? `<small>${esc(o.note)}</small>` : ""}</td>
      <td>${usd(o.price_usd)}<small>${ars(o.amount_ars)} · MEP ${esc(Number(o.fx_mep).toLocaleString("es-AR"))}</small></td>
      <td><span class="admin-pill admin-pill--${cls}">${esc(label)}</span>${o.status === "paid" ? `<small>${esc(METHOD_LABEL[o.payment_method] || o.payment_method)}${o.manual_note ? ` · ${esc(o.manual_note)}` : ""}</small>` : ""}</td>
      <td class="admin-actions">
        ${canCopy ? `<button type="button" class="mp-btn ghost small" data-copy="${esc(o.init_point)}">COPIAR LINK</button>` : ""}
        ${o.status === "pending" || o.status === "expired" ? `<button type="button" class="mp-btn ghost small" data-markpaid-open="${esc(o.id)}">MARCAR COMO PAGADO</button>` : ""}
      </td>
    </tr>`;
}

async function loadShop() {
  const [prods, ords] = await Promise.all([adminListProducts(), adminListOrders()]);
  products = prods;
  orders = ords;
  productsEl.innerHTML = prods.map(renderProduct).join("");
  ordersEl.innerHTML = orders.length
    ? orders.map(renderOrder).join("")
    : `<tr><td colspan="6">Todavía no hay pedidos.</td></tr>`;

  const prodSel = linkForm.elements.namedItem("product");
  // También los ocultos del shop (ej. "EP listo para enviar"): se venden con link de admin
  prodSel.innerHTML = prods.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}${p.price_usd ? ` — ${usd(p.price_usd)} por ${esc(p.unit)}` : ""}${p.active ? "" : " (no visible en el shop)"}</option>`).join("");
  const stSel = linkForm.elements.namedItem("student");
  stSel.innerHTML = `<option value="">Otra persona (no es alumno)</option>` +
    students.filter((s) => s.email).map((s) => `<option value="${esc(s.id)}">${esc(s.full_name)}</option>`).join("");
  syncLinkForm();
}

// El precio sugerido es el de lista × cantidad; vos lo cambiás al especial
function syncLinkForm() {
  const p = products.find((x) => x.id === linkForm.elements.namedItem("product").value);
  const qty = linkForm.elements.namedItem("quantity");
  qty.max = p?.max_qty || 1;
  if (Number(qty.value) > Number(qty.max)) qty.value = qty.max;
  if (p?.price_usd) linkForm.elements.namedItem("price").value = (p.price_usd * Number(qty.value || 1)).toFixed(2);
  const isStudent = Boolean(linkForm.elements.namedItem("student").value);
  linkForm.querySelectorAll("[data-other]").forEach((el) => { el.hidden = isStudent; });
}
linkForm.addEventListener("change", (e) => {
  if (["product", "quantity", "student"].includes(e.target.name)) syncLinkForm();
});

linkForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = linkForm.elements;
  const btn = linkForm.querySelector('button[type="submit"]');
  btn.disabled = true;
  linkResult.hidden = true;
  try {
    const out = await adminCreatePaymentLink({
      product_id: f.namedItem("product").value,
      student_id: f.namedItem("student").value || null,
      name: f.namedItem("name").value.trim(),
      email: f.namedItem("email").value.trim(),
      quantity: Number(f.namedItem("quantity").value || 1),
      price_usd: Number(f.namedItem("price").value),
      note: f.namedItem("note").value.trim(),
    });
    linkResult.innerHTML = `
      <p>Link listo: <strong>${usd(out.price_usd)}</strong> → <strong>${ars(out.amount_ars)}</strong> (MEP ${esc(out.fx_mep)}). Vence en 7 días.</p>
      <div class="admin-linkresult__row">
        <input type="text" readonly value="${esc(out.init_point)}" aria-label="Link de pago" />
        <button type="button" class="mp-btn primary small" data-copy="${esc(out.init_point)}">COPIAR</button>
      </div>`;
    linkResult.hidden = false;
    await loadShop();
  } catch (err) {
    say(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

productsEl.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-price-form]");
  if (!form) return;
  e.preventDefault();
  const id = form.closest("tr").dataset.productId;
  const p = products.find((x) => x.id === id);
  const price = Number(form.querySelector("input").value);
  if (!Number.isFinite(price) || price <= 0) { say("Precio inválido.", true); return; }
  try {
    await adminUpdateProduct(id, { price_usd: Math.round(price * 100) / 100, active: p.active });
    say(`${p.name}: precio actualizado a ${usd(price)}.`);
    await loadShop();
  } catch (err) {
    say(err.message, true);
  }
});

// Alta / edición de productos (mismo formulario: EDITAR lo carga con los datos del producto)
const productForm = $("[data-product-form]");
function resetProductForm() {
  productForm.reset();
  productForm.elements.namedItem("id").value = "";
  $("[data-product-form-title]").textContent = "Nuevo producto";
  $("[data-product-submit]").textContent = "CREAR PRODUCTO";
  $("[data-product-cancel]").hidden = true;
}
productsEl.addEventListener("click", (e) => {
  if (!e.target.closest("[data-edit-product]")) return;
  const p = products.find((x) => x.id === e.target.closest("tr").dataset.productId);
  if (!p) return;
  const f = productForm.elements;
  f.namedItem("id").value = p.id;
  f.namedItem("name").value = p.name;
  f.namedItem("price").value = p.price_usd ?? "";
  f.namedItem("unit").value = p.unit;
  f.namedItem("max_qty").value = p.max_qty;
  f.namedItem("description").value = p.description || "";
  f.namedItem("active").checked = p.active;
  $("[data-product-form-title]").textContent = `Editar: ${p.name}`;
  $("[data-product-submit]").textContent = "GUARDAR CAMBIOS";
  $("[data-product-cancel]").hidden = false;
  productForm.scrollIntoView({ behavior: "smooth", block: "center" });
});
$("[data-product-cancel]").addEventListener("click", resetProductForm);
productForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = productForm.elements;
  const name = f.namedItem("name").value.trim();
  const price = Number(f.namedItem("price").value);
  const maxQty = Math.round(Number(f.namedItem("max_qty").value) || 1);
  if (name.length < 2) { say("Poné un nombre.", true); return; }
  if (!Number.isFinite(price) || price <= 0) { say("Precio inválido.", true); return; }
  if (maxQty < 1 || maxQty > 20) { say("El máximo por compra va de 1 a 20.", true); return; }
  const btn = $("[data-product-submit]");
  btn.disabled = true;
  try {
    const editing = Boolean(f.namedItem("id").value);
    await adminSaveProduct({
      id: f.namedItem("id").value || null,
      name,
      description: f.namedItem("description").value.trim(),
      price_usd: Math.round(price * 100) / 100,
      unit: f.namedItem("unit").value,
      max_qty: maxQty,
      active: f.namedItem("active").checked,
    });
    say(`${name}: ${editing ? "cambios guardados" : "producto creado"}.`);
    resetProductForm();
    await loadShop();
  } catch (err) {
    say(err.message, true);
  } finally {
    btn.disabled = false;
  }
});

productsEl.addEventListener("change", async (e) => {
  const box = e.target.closest("[data-active]");
  if (!box) return;
  const id = box.closest("tr").dataset.productId;
  const p = products.find((x) => x.id === id);
  try {
    await adminUpdateProduct(id, { price_usd: p.price_usd, active: box.checked });
    say(`${p.name}: ${box.checked ? "visible" : "oculto"} en el shop.`);
    await loadShop();
  } catch (err) {
    box.checked = !box.checked;
    say(err.message, true);
  }
});

// ── Marcar como pagado (transferencia / efectivo) ──
const markEl = $("[data-markpaid]");
const markForm = $("[data-markpaid-form]");
const markResult = $("[data-markpaid-result]");
const markSubmit = $("[data-markpaid-submit]");
let markingOrder = null;

const MARK_MESSAGES = {
  student_required: "Elegí el alumno para activarle el acceso.",
  already_paid: "Esta orden ya estaba pagada.",
  student_not_found: "No encontré ese alumno. Recargá la página.",
  not_found: "No encontré esa orden. Recargá la página.",
  invalid_method: "Elegí el medio de pago.",
  unauthorized: "Tu sesión no tiene permisos de admin. Volvé a entrar con tu PIN.",
  no_session: "Tu sesión se cerró. Volvé a entrar con tu PIN.",
  network: "Sin conexión. Revisá tu internet y probá de nuevo.",
};

function openMarkPaid(order) {
  markingOrder = order;
  const isPlan = order.kind === "plan";
  $("[data-markpaid-summary]").innerHTML =
    `<strong>${esc(order.product_name)}</strong> · ${esc(order.buyer_name)} (${esc(order.buyer_email)})<br>` +
    `Monto del pedido: <strong>${usd(order.price_usd)}</strong> = <strong>${ars(order.amount_ars)}</strong> (MEP ${esc(Number(order.fx_mep).toLocaleString("es-AR"))}). Comparalo con lo que te entró.`;
  $("[data-markpaid-required]").textContent = isPlan ? "(obligatorio: le activa 30 días)" : "(opcional)";
  const sel = markForm.elements.namedItem("student");
  sel.innerHTML = `<option value="">${isPlan ? "Elegí el alumno…" : "Ninguno (no es alumno)"}</option>` +
    students.map((s) => `<option value="${esc(s.id)}"${s.id === order.student_id ? " selected" : ""}>${esc(s.full_name)}</option>`).join("");
  markForm.elements.namedItem("method").value = "transferencia";
  markForm.elements.namedItem("note").value = "";
  markResult.textContent = "";
  markResult.className = "admin-markpaid__result";
  markForm.hidden = false;
  markEl.hidden = false;
  markEl.scrollIntoView({ behavior: "smooth", block: "center" });
  markEl.focus({ preventScroll: true });
}

function closeMarkPaid() {
  markingOrder = null;
  markEl.hidden = true;
}

ordersEl.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-markpaid-open]");
  if (!btn) return;
  const order = orders.find((o) => o.id === btn.dataset.markpaidOpen);
  if (order) openMarkPaid(order);
});
$("[data-markpaid-cancel]").addEventListener("click", closeMarkPaid);

markForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!markingOrder) return;
  const f = markForm.elements;
  const studentId = f.namedItem("student").value || null;
  const show = (text, tone) => {
    markResult.textContent = text;
    markResult.className = `admin-markpaid__result is-${tone}`;
  };
  if (markingOrder.kind === "plan" && !studentId) { show(MARK_MESSAGES.student_required, "error"); f.namedItem("student").focus(); return; }

  markSubmit.disabled = true;
  show("Guardando…", "info");
  const out = await adminMarkOrderPaid({
    order_id: markingOrder.id,
    student_id: studentId,
    method: f.namedItem("method").value,
    note: f.namedItem("note").value.trim(),
  });
  markSubmit.disabled = false;

  if (out.result === "paid") {
    let text = out.plan === "activated"
      ? `Pagado. Acceso activo hasta el ${new Date(out.until).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" })}.`
      : "Pagado.";
    if (out.mp_link_still_active) text += " No se pudo anular el link de MercadoPago: anulalo desde tu cuenta de MercadoPago.";
    show(text, out.mp_link_still_active ? "warn" : "ok");
    // La fila cambia al instante; la recarga completa (alumnos + pedidos) tarda unos segundos
    Object.assign(markingOrder, {
      status: "paid",
      payment_method: f.namedItem("method").value,
      manual_note: f.namedItem("note").value.trim() || null,
    });
    ordersEl.innerHTML = orders.map(renderOrder).join("");
    markForm.hidden = true;
    markingOrder = null;
    await reloadAll().then(() => loadShop()).catch(() => {});
    return;
  }
  const text = out.result === "invalid_status"
    ? `Esta orden no se puede marcar como pagada (está ${STATUS[out.status]?.[0]?.toLowerCase() || out.status}).`
    : MARK_MESSAGES[out.result] || "No se pudo marcar como pagado. Probá de nuevo.";
  show(text, "error");
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const prev = btn.textContent;
    btn.textContent = "¡COPIADO!";
    setTimeout(() => { btn.textContent = prev; }, 1500);
  } catch {
    say("No pude copiar: seleccioná el link y copialo a mano.", true);
  }
});

async function boot() {
  if (!hasSupabase() || !supabase) { say("Supabase no configurado.", true); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    msg.innerHTML = `Iniciá sesión con tu PIN de admin en <a href="alumnos.html">el espacio de alumnos</a>: te trae directo acá.`;
    return;
  }
  if (!(await isAdmin())) { say("Esta cuenta no tiene acceso al panel.", true); return; }

  say("");
  actions.hidden = false;
  pinbar.hidden = false;
  shopEl.hidden = false;
  // El shop usa la lista de alumnos (selector del link de pago): primero alumnos
  await Promise.all([
    reloadAll().then(() => loadShop()).catch((e) => console.error("[admin]", e)),
    loadSync().catch(() => {}),
  ]);
}

boot().catch((err) => {
  console.error("[admin]", err);
  say("No se pudo cargar el panel.", true);
});
