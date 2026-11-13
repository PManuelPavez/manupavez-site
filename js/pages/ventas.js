// ventas.js — Panel de entradas (/ventas). Dos accesos:
//  · Manu: PIN de admin (sesión de Supabase). Todo sale de admin_ticket_dashboard (la base verifica is_admin).
//    Se cierra solo tras 20 min sin tocar nada.
//  · Socio: PIN propio de 6 números (partner_login). Solo ve recaudación y tandas, y suma invitados.
//    La base no le devuelve pedidos, mails, teléfonos, RRPP, códigos ni cuántos entraron.
//  · Puerta (solo Manu): códigos de 6 números elegidos a mano, celulares conectados (se cierran
//    uno por uno o todos), lista completa con "Deshacer" y hoja para imprimir sin números ni totales.
// Se refresca cada 30 s.
import { supabase } from "../data/supabaseClient.js";
import { loginWithPin, rememberPin } from "../features/pinLogin.js";
import { mountTurnstile } from "../features/turnstile.js";

const cfg = window.MP_SUPABASE || {};
const SLUG = new URLSearchParams(location.search).get("evento") || "pergamino";
const SITE = "https://manupavez.com";
const REFRESH_MS = 30_000;
const IDLE_MS = 20 * 60_000;
const PARTNER_KEY = "mp_partner";

const $ = (s, el = document) => el.querySelector(s);
const ars = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const num = (n) => Number(n || 0).toLocaleString("es-AR");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (iso) => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const nowHHMM = () => new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

let mode = null; // "admin" | "partner"
let dash = null;
let doorList = [];
let doorSessions = null;
let partnerToken = null;
let timer = null;
let idleTimer = null;

function status(text) { $("[data-status]").textContent = text || ""; }

function setHeader(ev, kicker) {
  $("[data-title]").textContent = ev?.name || "Entradas";
  const fecha = ev?.date ? new Date(`${ev.date}T12:00:00-03:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }) : "";
  $("[data-sub]").textContent = [fecha, ev?.venue].filter(Boolean).join(" · ") + ` · actualizado ${nowHHMM()}`;
  $(".vt-kicker").textContent = kicker;
}

// Barras de tandas: el ancho va por CSSOM (la CSP no deja estilos inline)
function renderTiers(el, tiers) {
  el.innerHTML = (tiers || []).map((x) => `<div class="vt-tier${x.active ? "" : " is-off"}">
      <div class="vt-tier__top"><span><strong>${esc(x.name)}</strong> · ${ars(x.price)}${x.active ? "" : " · apagada"}</span>
      <span>${num(x.sold)} vendidas${x.reserved ? ` + ${num(x.reserved)} pagando` : ""} / ${num(x.stock)} · quedan ${num(Math.max(0, x.stock - x.sold - x.reserved))}</span></div>
      <div class="vt-bar"><i class="is-sold"></i><i class="is-res"></i></div></div>`).join("") || `<p class="vt-help">No hay tandas cargadas.</p>`;
  [...el.querySelectorAll(".vt-tier")].forEach((row, i) => {
    const x = tiers[i];
    const stock = Math.max(1, x.stock);
    const sold = Math.min(100, (x.sold / stock) * 100);
    row.querySelector(".is-sold").style.width = `${sold}%`;
    row.querySelector(".is-res").style.width = `${Math.min(100 - sold, (x.reserved / stock) * 100)}%`;
  });
}

const kpiHTML = (list) => list.map(([n, l]) => `<div class="vt-kpi"><span class="vt-kpi__n">${esc(n)}</span><span class="vt-kpi__l">${esc(l)}</span></div>`).join("");

function guestItems(list) {
  return list.map((g) => `<li class="${g.in ? "is-in" : ""}"><span>${esc(g.name)}</span>
    <small>${g.added_by ? `por ${esc(g.added_by)} · ` : ""}${when(g.created_at)}${g.in ? " · ✓ adentro" : ""}</small></li>`).join("")
    || `<li class="vt-help">Todavía no hay invitados.</li>`;
}

function startRefresh(fn) {
  clearInterval(timer);
  timer = setInterval(fn, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) fn(); });
}

// ================= LOGIN =================
function selectTab(which) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === which)));
  $("[data-pin-form]").hidden = which !== "admin";
  $("[data-partner-form]").hidden = which !== "partner";
  (which === "admin" ? $("#vt-pin") : $("#vt-ppin")).focus();
}

async function showLogin(msg = "") {
  status(msg);
  $("[data-login]").hidden = false;
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => selectTab(b.dataset.tab)));

  // Manu
  const form = $("[data-pin-form]");
  const note = $("[data-note]");
  const captcha = await mountTurnstile($("[data-captcha]"));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = form.password.value.trim();
    note.textContent = "Verificando…";
    note.classList.remove("is-error");
    const r = await loginWithPin(pin, await captcha.getToken());
    captcha.reset();
    if (!r.ok) { note.textContent = r.message; note.classList.add("is-error"); form.password.value = ""; return; }
    await rememberPin(pin, { admin: true });
    $("[data-login]").hidden = true;
    startAdmin();
  });

  // Socio
  const pform = $("[data-partner-form]");
  const pnote = $("[data-partner-note]");
  pform.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pin = pform.password.value.trim();
    pnote.classList.add("is-error");
    if (!/^\d{6}$/.test(pin)) { pnote.textContent = "El PIN tiene 6 números."; return; }
    pnote.classList.remove("is-error");
    pnote.textContent = "Verificando…";
    let r;
    try { r = await partnerRpc("partner_login", { p_pin: pin }); }
    catch { pnote.textContent = "Sin conexión. Probá de nuevo."; pnote.classList.add("is-error"); return; }
    pform.password.value = "";
    if (r?.token) {
      savePartner(r.token);
      pnote.textContent = "";
      $("[data-login]").hidden = true;
      startPartner();
      return;
    }
    pnote.classList.add("is-error");
    pnote.textContent = "PIN incorrecto.";
  });

  for (const [f, input] of [[form, "#vt-pin"], [pform, "#vt-ppin"]]) {
    $(input).addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
      if (e.target.value.length === 6) f.requestSubmit();
    });
  }
  selectTab("admin");
}

// ================= MANU (admin) =================
async function load() {
  const [{ data, error }, ses, list] = await Promise.all([
    supabase.rpc("admin_ticket_dashboard", { p_slug: SLUG }),
    supabase.rpc("admin_door_sessions", { p_slug: SLUG }),
    supabase.rpc("admin_door_list", { p_slug: SLUG }),
  ]);
  if (!ses.error && !ses.data?.error) doorSessions = ses.data;
  if (!list.error && Array.isArray(list.data)) doorList = list.data;
  if (error) {
    if (/forbidden|permission/i.test(error.message)) {
      clearInterval(timer);
      $("[data-dash]").hidden = true;
      $("[data-head-actions]").hidden = true;
      mode = null;
      showLogin("Esta cuenta no es de admin. Entrá con tu PIN de admin o con el PIN de socio.");
      return;
    }
    status("No se pudo actualizar. Reintentando…");
    return;
  }
  if (data?.error) { status("No encontré el evento."); return; }
  dash = data;
  status("");
  $("[data-dash]").hidden = false;
  $("[data-head-actions]").hidden = false;
  render();
}

function render() {
  const d = dash;
  setHeader(d.event, "Panel de ventas · Manu");

  const t = d.totals || {};
  $("[data-kpis]").innerHTML = kpiHTML([
    [num(t.tickets), "Entradas vendidas"],
    [ars(t.revenue), "Recaudado"],
    [num(t.orders), "Compras"],
    [num(t.guests), "Invitados"],
    [`${num(d.checked_in)} / ${num((t.tickets || 0) + (t.guests || 0))}`, "Adentro"],
    [num(t.pending), "Reservadas pagando"],
    [num(d.waitlist), "Lista de espera"],
    [num(d.fans), "Fans en la lista"],
  ]);

  renderTiers($("[data-tiers]"), d.tiers);

  // RRPP: ventas + link de cada uno
  const sales = new Map((d.by_rrpp || []).map((r) => [r.code, r]));
  const rows = (d.rrpp || []).map((r) => {
    const s = sales.get(r.code) || {};
    const link = `${SITE}/pergamino.html?rrpp=${r.code}`;
    return `<tr><td>${esc(r.name)}${r.active ? "" : " (inactivo)"}<br><small>${esc(r.code)}</small></td>
      <td class="num">${num(s.tickets)}</td><td class="num">${ars(s.revenue)}</td>
      <td><button type="button" class="vt-copy" data-copy="${esc(link)}">Copiar link</button></td></tr>`;
  });
  const none = sales.get("Sin RRPP");
  if (none) rows.push(`<tr><td>Sin RRPP</td><td class="num">${num(none.tickets)}</td><td class="num">${ars(none.revenue)}</td><td></td></tr>`);
  $("[data-rrpp-table]").innerHTML = `<thead><tr><th>RRPP</th><th class="num">Entradas</th><th class="num">Recaudado</th><th></th></tr></thead><tbody>${rows.join("") || `<tr><td colspan="4">Todavía no hay RRPP cargados.</td></tr>`}</tbody>`;

  const codes = d.door_codes || [];
  const codeItem = (c, what) => `
    <li class="${c.active ? "" : "is-off"}"><div><strong>${esc(c.label)}</strong>
      <small>${c.active ? `${num(c.sessions)} celular(es) conectados${what === "door" ? ` · ${num(c.checkins)} ingresos marcados` : ""}` : "Desactivado"}</small></div>
      <button type="button" class="mp-btn ghost small" data-toggle="${c.id}" data-on="${c.active ? "0" : "1"}" data-kind="${what}">${c.active ? "DESACTIVAR" : "ACTIVAR"}</button></li>`;
  $("[data-codes]").innerHTML = codes.filter((c) => (c.role || "door") === "door").map((c) => codeItem(c, "door")).join("")
    || `<li>Todavía no hay códigos. Creá uno por persona de seguridad.</li>`;
  $("[data-partners]").innerHTML = codes.filter((c) => c.role === "partner").map((c) => codeItem(c, "partner")).join("")
    || `<li>Todavía no hay PIN de socio.</li>`;

  const guests = (d.orders || []).filter((o) => o.method === "invitado" && o.status === "approved")
    .map((o) => ({ name: o.buyer, added_by: o.added_by, created_at: o.created_at }));
  $("[data-guests]").innerHTML = guestItems(guests);

  renderOrders();
  renderSessions();
  renderDoor();
}

// Navegador → texto corto ("iPhone · Safari")
function deviceName(ua = "") {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : "Otro";
  const br = /CriOS|Chrome/.test(ua) && !/Edg/.test(ua) ? "Chrome" : /Edg/.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox"
    : /Safari/.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ");
}

function renderSessions() {
  const s = doorSessions;
  if (!s) return;
  $("[data-failed]").textContent = `Códigos mal ingresados: ${num(s.failed_1h)} en la última hora · ${num(s.failed_24h)} en 24 h.`
    + (s.failed_1h >= 10 ? " ⚠ Alguien está probando códigos: cambiá los de puerta." : "");
  $("[data-sessions]").innerHTML = (s.sessions || []).map((x) => `
    <li><div><strong>${esc(x.label)}</strong> <span class="vt-tag ${x.role === "partner" ? "is-guest" : "is-approved"}">${x.role === "partner" ? "Socio" : "Puerta"}</span>
      <small>${esc(deviceName(x.device || ""))} · entró ${when(x.created_at)}${x.last_seen_at ? ` · última actividad ${when(x.last_seen_at)}` : ""}</small></div>
      <button type="button" class="mp-btn ghost small" data-end="${x.id}">CERRAR</button></li>`).join("")
    || `<li>No hay ningún celular conectado.</li>`;
}

function renderDoor() {
  const q = norm($("[data-door-q]").value);
  const list = doorList.filter((p) => !q || norm(`${p.first} ${p.last} ${p.buyer} ${p.code}`).includes(q));
  $("[data-door]").innerHTML = list.map((p) => `
    <li class="${p.in_at ? "is-in" : ""}"><div><strong>${esc(p.last)}, ${esc(p.first)}</strong>
      <small>${esc(p.tier || "")} · ${esc(p.code)}${norm(p.buyer) !== norm(`${p.first} ${p.last}`) ? ` · compró ${esc(p.buyer)}` : ""}${p.in_at ? ` · ✓ entró ${when(p.in_at)}${p.in_by ? ` (${esc(p.in_by)})` : ""}` : ""}</small></div>
      ${p.in_at ? `<button type="button" class="mp-btn ghost small" data-undo="${p.id}" data-name="${esc(`${p.first} ${p.last}`)}">DESHACER</button>` : ""}</li>`).join("")
    || `<li class="vt-help">${q ? "Nadie con esa búsqueda." : "Todavía no hay nadie en la lista."}</li>`;
}

// Hoja para imprimir: casillero, apellido, nombre, tipo y quién compró. Sin números ni totales.
function printDoorList(from, to) {
  const letter = (p) => norm(p.last).trim().charAt(0).toUpperCase();
  const rows = doorList.filter((p) => { const l = letter(p); return l >= from && l <= to; });
  const ev = dash?.event || {};
  const fecha = ev.date ? new Date(`${ev.date}T12:00:00-03:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }) : "";
  $("[data-print]").innerHTML = `
    <h1>${esc(ev.name || "Lista de puerta")}</h1>
    <p>${esc(fecha)}${ev.venue ? ` · ${esc(ev.venue)}` : ""} · Apellidos ${esc(from)} a ${esc(to)} · Pedir DNI</p>
    <table><thead><tr><th></th><th>Apellido</th><th>Nombre</th><th>Tipo</th><th>Compró</th></tr></thead>
    <tbody>${rows.map((p) => `<tr><td class="box"></td><td>${esc(p.last)}</td><td>${esc(p.first)}</td><td>${esc(p.tier || "")}</td>
      <td>${norm(p.buyer) !== norm(`${p.first} ${p.last}`) ? esc(p.buyer) : ""}</td></tr>`).join("")}</tbody></table>`;
  window.print();
}

function renderOrders() {
  const q = norm($("[data-order-q]").value);
  const list = (dash?.orders || []).filter((o) => !q || norm(`${o.buyer} ${o.email} ${o.code} ${(o.people || []).join(" ")} ${o.rrpp || ""} ${o.added_by || ""}`).includes(q));
  $("[data-orders]").innerHTML = list.map((o) => {
    const tag = o.method === "invitado" ? `<span class="vt-tag is-guest">Invitado${o.added_by ? ` · ${esc(o.added_by)}` : ""}</span>`
      : o.method === "transferencia" && o.status === "approved" ? `<span class="vt-tag is-approved">Transferencia${o.added_by ? ` · ${esc(o.added_by)}` : ""}</span>`
      : o.status === "approved" ? `<span class="vt-tag is-approved">Pagado</span>` : `<span class="vt-tag is-pending">Pagando</span>`;
    return `<article class="vt-order">
      <div class="vt-order__who">${esc(o.buyer)} ${tag}</div>
      <div class="vt-order__right">${o.quantity}× ${esc(o.tier_name || "")} · ${ars(o.total_ars)}</div>
      <div class="vt-order__meta">${esc(o.code)} · ${when(o.created_at)}${o.email ? ` · ${esc(o.email)}` : ""}${o.phone ? ` · ${esc(o.phone)}` : ""}${o.rrpp ? ` · RRPP ${esc(o.rrpp)}` : ""}</div>
      <div class="vt-order__people">Entran: ${esc((o.people || []).join(", "))}</div>
      ${o.id && o.status === "approved" && o.added_by && ["invitado", "transferencia"].includes(o.method) && !o.checked_in
        ? `<div class="vt-order__actions"><button type="button" class="mp-btn ghost small" data-remove="${esc(o.id)}" data-kind="${esc(o.method)}" data-name="${esc(o.buyer)}">QUITAR</button></div>` : ""}
    </article>`;
  }).join("") || `<p class="vt-help">${q ? "Nada con esa búsqueda." : "Todavía no hay pedidos."}</p>`;
}

function showNewCode(box, data, what) {
  box.hidden = false;
  if (!data) { box.textContent = "No se pudo crear."; return; }
  box.innerHTML = `${what} para <b>${esc(data.label)}</b> (anotalo: no se vuelve a mostrar)<strong>${esc(data.code)}</strong>`;
}

// Reenvía el mail "Estás en la lista" a los pedidos pagos que todavía no lo recibieron
// (por ejemplo, cuando Resend no tenía el dominio verificado).
async function resendMails() {
  const btn = $("[data-resend-mails]");
  const note = $("[data-resend-note]");
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { note.hidden = false; note.textContent = "La sesión venció. Volvé a entrar."; return; }
  btn.disabled = true;
  note.hidden = false;
  note.textContent = "Enviando…";
  try {
    const res = await fetch(`${cfg.url}/functions/v1/tickets-resend`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: "{}",
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) note.textContent = "No se pudo reenviar (sin permiso o error del servidor).";
    else if (!r.total) note.textContent = "No hay mails pendientes: a todos los compradores ya les llegó.";
    else if (!r.failed) note.textContent = `Listo: ${r.sent} mail(s) enviado(s).`;
    else note.textContent = `Enviados ${r.sent} de ${r.total}. Fallaron ${r.failed}: ${r.error?.includes("403") ? "Resend todavía no tiene el dominio verificado." : r.error || "error desconocido"}`;
  } catch {
    note.textContent = "Sin conexión. Probá de nuevo.";
  }
  btn.disabled = false;
}

// Aviso "Cambio de fecha y lugar" a quienes ya compraron. Pide confirmar con un segundo toque;
// el servidor no le repite el mail a quien ya lo recibió.
async function sendChangeNotice() {
  const btn = $("[data-change-notice]");
  const note = $("[data-resend-note]");
  note.hidden = false;
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "¿SEGURO? TOCÁ DE NUEVO PARA ENVIAR";
    note.textContent = "Le llega el aviso de cambio de fecha a cada comprador que todavía no lo recibió.";
    setTimeout(() => { btn.dataset.armed = ""; btn.textContent = "AVISAR CAMBIO DE FECHA"; }, 8000);
    return;
  }
  btn.dataset.armed = "";
  btn.textContent = "AVISAR CAMBIO DE FECHA";
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { note.textContent = "La sesión venció. Volvé a entrar."; return; }
  btn.disabled = true;
  note.textContent = "Enviando…";
  try {
    const res = await fetch(`${cfg.url}/functions/v1/tickets-change-notice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ send: true }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) note.textContent = "No se pudo enviar (sin permiso o error del servidor).";
    else if (!r.total) note.textContent = "No hay a quién avisar: todos los compradores ya recibieron el aviso.";
    else if (!r.failed) note.textContent = `Listo: aviso enviado a ${r.sent} comprador(es).`;
    else note.textContent = `Enviados ${r.sent} de ${r.total}. Fallaron ${r.failed}: ${r.error || "error desconocido"}`;
  } catch {
    note.textContent = "Sin conexión. Probá de nuevo.";
  }
  btn.disabled = false;
}

function bindAdmin() {
  $("[data-refresh]").addEventListener("click", load);
  $("[data-logout]").addEventListener("click", async () => { await supabase.auth.signOut(); location.reload(); });
  $("[data-order-q]").addEventListener("input", renderOrders);
  $("[data-door-q]").addEventListener("input", renderDoor);
  const letters = [..."ABCDEFGHIJKLMNÑOPQRSTUVWXYZ"].filter((l) => l !== "Ñ");
  document.querySelectorAll("[data-letter]").forEach((sel, i) => {
    sel.innerHTML = letters.map((l) => `<option${(i === 0 ? l === "A" : l === "Z") ? " selected" : ""}>${l}</option>`).join("");
  });
  $("[data-print-form]").addEventListener("submit", (e) => {
    e.preventDefault();
    const from = e.target.from.value;
    const to = e.target.to.value;
    if (from > to) { status("La primera letra tiene que ir antes que la segunda."); return; }
    printDoorList(from, to);
  });
  $("[data-resend-mails]").addEventListener("click", resendMails);
  $("[data-change-notice]").addEventListener("click", sendChangeNotice);

  document.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = "¡Copiado!"; }
      catch { prompt("Copiá el link:", copy.dataset.copy); }
      setTimeout(() => (copy.textContent = "Copiar link"), 1500);
      return;
    }
    const end = e.target.closest("[data-end]");
    if (end) {
      if (!confirm("¿Cerrar la sesión de este celular? Para volver a entrar va a necesitar el código.")) return;
      await supabase.rpc("admin_door_session_end", { p_id: end.dataset.end });
      load();
      return;
    }
    const all = e.target.closest("[data-end-all]");
    if (all) {
      const who = all.dataset.endAll === "partner" ? "del socio" : "de puerta";
      if (!confirm(`¿Cerrar TODOS los celulares ${who}? Los códigos siguen activos: con el código pueden volver a entrar.`)) return;
      const { data } = await supabase.rpc("admin_door_sessions_end_all", { p_slug: SLUG, p_role: all.dataset.endAll });
      status(`Se cerraron ${num(data)} sesión(es).`);
      load();
      return;
    }
    const rm = e.target.closest("[data-remove]");
    if (rm) {
      if (!confirm(`¿Quitar a ${rm.dataset.name}? Sale de la puerta${rm.dataset.kind === "transferencia" ? ", de la recaudación y de la lista del socio" : ""}.`)) return;
      rm.disabled = true;
      const { data, error } = await supabase.rpc("admin_remove_manual", { p_order_id: rm.dataset.remove });
      if (error || data?.error) {
        rm.disabled = false;
        alert(data?.error === "checked_in" ? "Ya entró. Primero deshacé el ingreso en la lista de puerta." : "No se pudo quitar.");
        return;
      }
      status(`Se quitó a ${rm.dataset.name}.`);
      load();
      return;
    }
    const undo = e.target.closest("[data-undo]");
    if (undo) {
      if (!confirm(`¿Marcar a ${undo.dataset.name} como que NO entró? Queda registrado.`)) return;
      await supabase.rpc("admin_checkin_undo", { p_attendee: undo.dataset.undo });
      load();
      return;
    }
    const tog = e.target.closest("[data-toggle]");
    if (tog) {
      const on = tog.dataset.on === "1";
      const warn = tog.dataset.kind === "partner"
        ? "¿Desactivar este PIN de socio? Sale del panel en todos sus dispositivos."
        : "¿Desactivar este código? Los celulares que lo usan salen de la puerta.";
      if (!on && !confirm(warn)) return;
      await supabase.rpc("admin_door_code_toggle", { p_id: tog.dataset.toggle, p_active: on });
      load();
    }
  });

  $("[data-code-form]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = e.target.label.value.trim();
    const code = e.target.code.value.trim();
    const note = $("[data-code-note]");
    note.classList.add("is-error");
    if (!label) { note.textContent = "Poné el nombre de quien lo va a usar."; return; }
    if (!/^\d{6}$/.test(code)) { note.textContent = "El código tiene que tener 6 números."; return; }
    const { data, error } = await supabase.rpc("admin_door_code_create", { p_slug: SLUG, p_label: label, p_code: code });
    const err = error ? "error" : data?.error;
    if (err) {
      note.textContent = {
        code_weak: "Ese código es muy fácil de adivinar (repetido o en escalera). Elegí otro.",
        code_taken: "Ese código ya se usó antes. Elegí otro.",
        code_format: "El código tiene que tener 6 números.",
      }[err] || "No se pudo crear.";
      return;
    }
    note.classList.remove("is-error");
    note.textContent = "";
    showNewCode($("[data-newcode]"), data, "Código de puerta");
    e.target.reset();
    load();
  });

  $("[data-partner-create]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = e.target.label.value.trim();
    if (!label) return;
    const { data, error } = await supabase.rpc("admin_partner_pin_create", { p_slug: SLUG, p_label: label });
    showNewCode($("[data-newpin]"), error || data?.error ? null : data, "PIN de socio");
    if (!error && !data?.error) { e.target.reset(); load(); }
  });

  $("[data-rrpp-form]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = $("[data-rrpp-note]");
    const { data, error } = await supabase.rpc("admin_rrpp_upsert", { p_name: e.target.name.value, p_code: e.target.code.value });
    if (error || data?.error) {
      note.textContent = data?.error === "code" ? "El código va sin espacios: 2 a 20 letras o números." : "No se pudo guardar.";
      note.classList.add("is-error");
      return;
    }
    note.classList.remove("is-error");
    note.textContent = `Listo. Link: ${SITE}/pergamino.html?rrpp=${data.code}`;
    e.target.reset();
    load();
  });

  // Carga a mano: invitado o transferencia (una persona por vez)
  const gform = $("[data-guest-form]");
  const syncGuestForm = async () => {
    const transfer = gform.method.value === "transferencia";
    gform.amount.hidden = !transfer;
    $("[data-guest-submit]").textContent = transfer ? "SUMAR TRANSFERENCIA" : "SUMAR INVITADO";
    if (transfer && !gform.amount.value) {
      // Precio de la tanda actual como sugerencia (se puede cambiar)
      const { data } = await supabase.rpc("public_event", { p_slug: SLUG });
      const price = data?.current?.price_ars;
      if (price && !gform.amount.value && gform.method.value === "transferencia") gform.amount.value = price;
    }
  };
  gform.method.addEventListener("change", syncGuestForm);
  gform.addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = $("[data-guest-note]");
    const f = e.target;
    const method = f.method.value;
    const first = f.first.value.trim();
    const last = f.last.value.trim();
    const fail = (t) => { note.textContent = t; note.classList.add("is-error"); };
    if (!first || !last) return fail("Completá nombre y apellido.");
    let amount = null;
    if (method === "transferencia") {
      amount = Number(f.amount.value);
      if (!f.amount.value || !Number.isInteger(amount) || amount < 0) return fail("Poné el monto transferido (solo números).");
    }
    const btn = $("[data-guest-submit]");
    btn.disabled = true;
    const { data, error } = await supabase.rpc("admin_add_manual", { p_slug: SLUG, p_first: first, p_last: last, p_method: method, p_amount: amount });
    btn.disabled = false;
    if (error || data?.error) return fail(data?.error === "name" ? "Completá nombre y apellido." : "No se pudo sumar. Probá de nuevo.");
    note.classList.remove("is-error");
    note.textContent = method === "transferencia"
      ? `Sumado: ${first} ${last} · transferencia ${ars(data.amount)} (${data.tier}).`
      : `Sumado: ${first} ${last} · invitado.`;
    f.first.value = "";
    f.last.value = "";
    f.first.focus();
    load();
  });

  // Lista de puerta en CSV (respaldo por si se cae la señal en la puerta)
  $("[data-csv]").addEventListener("click", () => {
    const rows = [["Nombre", "Tipo", "Compra", "Comprador", "Teléfono"]];
    for (const o of dash?.orders || []) {
      if (o.status !== "approved") continue;
      for (const p of o.people || []) rows.push([p, o.method === "invitado" ? "Invitado" : o.tier_name || "", o.code, o.buyer, o.phone || ""]);
    }
    rows.splice(1, rows.length, ...rows.slice(1).sort((a, b) => a[0].localeCompare(b[0], "es")));
    const csv = "﻿" + rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `lista-puerta-${SLUG}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
}

// Sin actividad por 20 min: cierra la sesión de admin (por si quedó abierto en una compu ajena)
function armIdleLock() {
  const reset = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      await supabase.auth.signOut();
      location.reload();
    }, IDLE_MS);
  };
  ["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => addEventListener(ev, reset, { passive: true }));
  reset();
}

let adminBound = false;
function startAdmin() {
  mode = "admin";
  if (!adminBound) { adminBound = true; bindAdmin(); armIdleLock(); }
  load();
  startRefresh(load);
}

// ================= SOCIO =================
async function partnerRpc(fn, args) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc_${res.status}`);
  return res.json();
}

function savePartner(t) {
  partnerToken = t;
  try { localStorage.setItem(PARTNER_KEY, JSON.stringify({ t, exp: Date.now() + 7 * 86400_000 })); } catch {}
}
function readPartner() {
  try {
    const s = JSON.parse(localStorage.getItem(PARTNER_KEY) || "null");
    return s && s.exp > Date.now() ? s.t : null;
  } catch { return null; }
}
function partnerLogout(msg = "") {
  try { localStorage.removeItem(PARTNER_KEY); } catch {}
  location.hash = msg ? "vencido" : "";
  location.reload();
}

async function loadPartner() {
  let d;
  try { d = await partnerRpc("partner_dashboard", { p_token: partnerToken }); }
  catch { status("No se pudo actualizar. Reintentando…"); return; }
  if (d?.error === "session") return partnerLogout("expired");
  status("");
  $("[data-partner]").hidden = false;
  $("[data-head-actions]").hidden = false;
  setHeader(d.event, `Panel de ventas · ${d.label || "Socio"}`);

  const t = d.totals || {};
  const cap = d.event?.capacity;
  $("[data-p-kpis]").innerHTML = kpiHTML([
    [num(t.tickets), "Entradas vendidas"],
    [ars(t.revenue), "Recaudado"],
    [num(t.guests), "Invitados"],
    ...(cap ? [[`${num((t.tickets || 0) + (t.guests || 0))} / ${num(cap)}`, "Capacidad usada"]] : []),
  ]);
  renderTiers($("[data-p-tiers]"), d.tiers);
  partnerSales = d.sales || [];
  renderPartnerSales();
  $("[data-p-guests]").innerHTML = guestItems(d.guests || []);
}

// Quién compró: nombre · cantidad · tanda · fecha y hora · monto (sin mails, teléfonos ni RRPP)
let partnerSales = [];
function renderPartnerSales() {
  const q = norm($("[data-p-sales-q]").value);
  const list = partnerSales.filter((s) => !q || norm(s.buyer).includes(q));
  $("[data-p-sales]").innerHTML = list.map((s) => `<article class="vt-order">
      <div class="vt-order__who">${esc(s.buyer)}</div>
      <div class="vt-order__right">${num(s.quantity)} ${Number(s.quantity) === 1 ? "entrada" : "entradas"} · ${ars(s.amount)}</div>
      <div class="vt-order__meta">${esc(s.tier || "")} · ${when(s.at)}</div>
    </article>`).join("") || `<p class="vt-help">${q ? "Nadie con ese nombre." : "Todavía no hay compras."}</p>`;
}

function startPartner() {
  mode = "partner";
  $("[data-p-sales-q]").addEventListener("input", renderPartnerSales);
  $("[data-refresh]").addEventListener("click", loadPartner);
  $("[data-logout]").addEventListener("click", () => {
    if (confirm("¿Salir del panel en este dispositivo?")) partnerLogout();
  });
  $("[data-p-guest-form]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const note = $("[data-p-guest-note]");
    const first = f.first.value.trim();
    const last = f.last.value.trim();
    note.classList.add("is-error");
    if (!first || !last) { note.textContent = "Completá nombre y apellido."; return; }
    let r;
    try { r = await partnerRpc("partner_add_guest", { p_token: partnerToken, p_first: first, p_last: last }); }
    catch { note.textContent = "Sin conexión. Probá de nuevo."; return; }
    if (r?.error === "session") return partnerLogout("expired");
    if (r?.error === "full") { note.textContent = "No hay más lugar: el evento llegó a la capacidad."; return; }
    if (r?.error) { note.textContent = "No se pudo sumar. Probá de nuevo."; return; }
    note.classList.remove("is-error");
    note.textContent = `Sumado: ${first} ${last}.`;
    f.reset();
    f.first.focus();
    loadPartner();
  });
  loadPartner();
  startRefresh(loadPartner);
}

// ================= INICIO =================
(async function init() {
  partnerToken = readPartner();
  if (partnerToken) return startPartner();
  if (!supabase) { status("No se pudo conectar."); return; }
  const { data } = await supabase.auth.getSession();
  if (data.session) startAdmin();
  else showLogin(location.hash === "#vencido" ? "La sesión de socio venció o se desactivó. Volvé a entrar." : "");
})();
