// ventas.js — Panel de entradas (/ventas). Dos accesos:
//  · Manu: PIN de admin (sesión de Supabase). Todo sale de admin_ticket_dashboard (la base verifica is_admin).
//    Se cierra solo tras 20 min sin tocar nada.
//  · Socio: PIN propio de 6 números (partner_login). Solo ve recaudación y tandas, y suma invitados.
//    La base no le devuelve pedidos, mails, teléfonos, RRPP ni códigos.
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
    if (r?.error === "locked") pnote.textContent = r.scope === "global" ? "Acceso pausado por seguridad. Avisale a Manu." : "Demasiados intentos. Esperá 15 minutos.";
    else pnote.textContent = r?.remaining > 0 ? `PIN incorrecto. Te quedan ${r.remaining} intentos.` : "PIN incorrecto.";
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
  const { data, error } = await supabase.rpc("admin_ticket_dashboard", { p_slug: SLUG });
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
}

function renderOrders() {
  const q = norm($("[data-order-q]").value);
  const list = (dash?.orders || []).filter((o) => !q || norm(`${o.buyer} ${o.email} ${o.code} ${(o.people || []).join(" ")} ${o.rrpp || ""} ${o.added_by || ""}`).includes(q));
  $("[data-orders]").innerHTML = list.map((o) => {
    const tag = o.method === "invitado" ? `<span class="vt-tag is-guest">Invitado${o.added_by ? ` · ${esc(o.added_by)}` : ""}</span>`
      : o.status === "approved" ? `<span class="vt-tag is-approved">Pagado</span>` : `<span class="vt-tag is-pending">Pagando</span>`;
    return `<article class="vt-order">
      <div class="vt-order__who">${esc(o.buyer)} ${tag}</div>
      <div class="vt-order__right">${o.quantity}× ${esc(o.tier_name || "")} · ${ars(o.total_ars)}</div>
      <div class="vt-order__meta">${esc(o.code)} · ${when(o.created_at)}${o.email ? ` · ${esc(o.email)}` : ""}${o.phone ? ` · ${esc(o.phone)}` : ""}${o.rrpp ? ` · RRPP ${esc(o.rrpp)}` : ""}</div>
      <div class="vt-order__people">Entran: ${esc((o.people || []).join(", "))}</div>
    </article>`;
  }).join("") || `<p class="vt-help">${q ? "Nada con esa búsqueda." : "Todavía no hay pedidos."}</p>`;
}

function showNewCode(box, data, what) {
  box.hidden = false;
  if (!data) { box.textContent = "No se pudo crear."; return; }
  box.innerHTML = `${what} para <b>${esc(data.label)}</b> (anotalo: no se vuelve a mostrar)<strong>${esc(data.code)}</strong>`;
}

function bindAdmin() {
  $("[data-refresh]").addEventListener("click", load);
  $("[data-logout]").addEventListener("click", async () => { await supabase.auth.signOut(); location.reload(); });
  $("[data-order-q]").addEventListener("input", renderOrders);

  document.addEventListener("click", async (e) => {
    const copy = e.target.closest("[data-copy]");
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = "¡Copiado!"; }
      catch { prompt("Copiá el link:", copy.dataset.copy); }
      setTimeout(() => (copy.textContent = "Copiar link"), 1500);
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
    if (!label) return;
    const { data, error } = await supabase.rpc("admin_door_code_create", { p_slug: SLUG, p_label: label });
    showNewCode($("[data-newcode]"), error || data?.error ? null : data, "Código de puerta");
    if (!error && !data?.error) { e.target.reset(); load(); }
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

  $("[data-guest-form]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = $("[data-guest-note]");
    const { data, error } = await supabase.rpc("admin_add_guest", { p_slug: SLUG, p_first: e.target.first.value, p_last: e.target.last.value });
    if (error || data?.error) { note.textContent = "Completá nombre y apellido."; note.classList.add("is-error"); return; }
    note.classList.remove("is-error");
    note.textContent = `Sumado: ${e.target.first.value} ${e.target.last.value}.`;
    e.target.reset();
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
    [`${num(d.checked_in)} / ${num((t.tickets || 0) + (t.guests || 0))}`, "Adentro"],
    ...(cap ? [[`${num((t.tickets || 0) + (t.guests || 0))} / ${num(cap)}`, "Capacidad usada"]] : []),
  ]);
  renderTiers($("[data-p-tiers]"), d.tiers);
  $("[data-p-guests]").innerHTML = guestItems(d.guests || []);
}

function startPartner() {
  mode = "partner";
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
