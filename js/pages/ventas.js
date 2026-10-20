// ventas.js — Panel de entradas (/ventas). Solo admin: entra con el mismo PIN de 6 números.
// Todo sale de la RPC admin_ticket_dashboard (la base verifica is_admin). Se refresca cada 30 s.
// Desde acá: códigos de puerta, RRPP, invitados y la lista de puerta en CSV (respaldo sin señal).
import { supabase } from "../data/supabaseClient.js";
import { loginWithPin, rememberPin } from "../features/pinLogin.js";
import { mountTurnstile } from "../features/turnstile.js";

const SLUG = new URLSearchParams(location.search).get("evento") || "pergamino";
const SITE = "https://manupavez.com";
const REFRESH_MS = 30_000;

const $ = (s, el = document) => el.querySelector(s);
const ars = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const num = (n) => Number(n || 0).toLocaleString("es-AR");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const when = (iso) => new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

let dash = null;
let timer = null;

function status(text) { $("[data-status]").textContent = text || ""; }

// ---------- Login ----------
async function showLogin() {
  status("");
  $("[data-login]").hidden = false;
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
    start();
  });
  form.password.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    if (e.target.value.length === 6) form.requestSubmit();
  });
  form.password.focus();
}

// ---------- Datos ----------
async function load() {
  const { data, error } = await supabase.rpc("admin_ticket_dashboard", { p_slug: SLUG });
  if (error) {
    if (/forbidden|permission/i.test(error.message)) {
      status("Tu usuario no tiene permiso de admin.");
      $("[data-dash]").hidden = true;
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
  const ev = d.event || {};
  $("[data-title]").textContent = ev.name || "Entradas";
  const fecha = ev.date ? new Date(`${ev.date}T12:00:00-03:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }) : "";
  $("[data-sub]").textContent = [fecha, ev.venue].filter(Boolean).join(" · ") + ` · actualizado ${new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false })}`;

  const t = d.totals || {};
  const kpis = [
    [num(t.tickets), "Entradas vendidas"],
    [ars(t.revenue), "Recaudado"],
    [num(t.orders), "Compras"],
    [num(t.guests), "Invitados"],
    [`${num(d.checked_in)} / ${num((t.tickets || 0) + (t.guests || 0))}`, "Adentro"],
    [num(t.pending), "Reservadas pagando"],
    [num(d.waitlist), "Lista de espera"],
    [num(d.fans), "Fans en la lista"],
  ];
  $("[data-kpis]").innerHTML = kpis.map(([n, l]) => `<div class="vt-kpi"><span class="vt-kpi__n">${esc(n)}</span><span class="vt-kpi__l">${esc(l)}</span></div>`).join("");

  $("[data-tiers]").innerHTML = (d.tiers || []).map((x) => {
    const stock = Math.max(1, x.stock);
    const sold = Math.min(100, (x.sold / stock) * 100);
    const res = Math.min(100 - sold, (x.reserved / stock) * 100);
    return `<div class="vt-tier${x.active ? "" : " is-off"}">
      <div class="vt-tier__top"><span><strong>${esc(x.name)}</strong> · ${ars(x.price)}${x.active ? "" : " · apagada"}</span>
      <span>${num(x.sold)} vendidas${x.reserved ? ` + ${num(x.reserved)} pagando` : ""} / ${num(x.stock)} · quedan ${num(Math.max(0, x.stock - x.sold - x.reserved))}</span></div>
      <div class="vt-bar"><i class="is-sold" style="width:${sold}%"></i><i class="is-res" style="width:${res}%"></i></div></div>`;
  }).join("");

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

  $("[data-codes]").innerHTML = (d.door_codes || []).map((c) => `
    <li class="${c.active ? "" : "is-off"}"><div><strong>${esc(c.label)}</strong>
      <small>${c.active ? `${num(c.sessions)} celular(es) conectados · ${num(c.checkins)} ingresos marcados` : "Desactivado"}</small></div>
      <button type="button" class="mp-btn ghost small" data-toggle="${c.id}" data-on="${c.active ? "0" : "1"}">${c.active ? "DESACTIVAR" : "ACTIVAR"}</button></li>`).join("")
    || `<li>Todavía no hay códigos. Creá uno por persona de seguridad.</li>`;

  renderOrders();
}

function renderOrders() {
  const q = norm($("[data-order-q]").value);
  const list = (dash?.orders || []).filter((o) => !q || norm(`${o.buyer} ${o.email} ${o.code} ${(o.people || []).join(" ")} ${o.rrpp || ""}`).includes(q));
  $("[data-orders]").innerHTML = list.map((o) => {
    const tag = o.method === "invitado" ? `<span class="vt-tag is-guest">Invitado</span>`
      : o.status === "approved" ? `<span class="vt-tag is-approved">Pagado</span>` : `<span class="vt-tag is-pending">Pagando</span>`;
    return `<article class="vt-order">
      <div class="vt-order__who">${esc(o.buyer)} ${tag}</div>
      <div class="vt-order__right">${o.quantity}× ${esc(o.tier_name || "")} · ${ars(o.total_ars)}</div>
      <div class="vt-order__meta">${esc(o.code)} · ${when(o.created_at)}${o.email ? ` · ${esc(o.email)}` : ""}${o.phone ? ` · ${esc(o.phone)}` : ""}${o.rrpp ? ` · RRPP ${esc(o.rrpp)}` : ""}</div>
      <div class="vt-order__people">Entran: ${esc((o.people || []).join(", "))}</div>
    </article>`;
  }).join("") || `<p class="vt-help">${q ? "Nada con esa búsqueda." : "Todavía no hay pedidos."}</p>`;
}

// ---------- Acciones ----------
function bindActions() {
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
      if (!on && !confirm("¿Desactivar este código? Los celulares que lo usan salen de la puerta.")) return;
      await supabase.rpc("admin_door_code_toggle", { p_id: tog.dataset.toggle, p_active: on });
      load();
    }
  });

  $("[data-code-form]").addEventListener("submit", async (e) => {
    e.preventDefault();
    const label = e.target.label.value.trim();
    if (!label) return;
    const { data, error } = await supabase.rpc("admin_door_code_create", { p_slug: SLUG, p_label: label });
    const box = $("[data-newcode]");
    box.hidden = false;
    if (error || data?.error) { box.textContent = "No se pudo crear el código."; return; }
    box.innerHTML = `Código para <b>${esc(data.label)}</b> (anotalo: no se vuelve a mostrar)<strong>${esc(data.code)}</strong>`;
    e.target.reset();
    load();
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

function start() {
  bindActions();
  load();
  clearInterval(timer);
  timer = setInterval(load, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}

(async function init() {
  if (!supabase) { status("No se pudo conectar."); return; }
  const { data } = await supabase.auth.getSession();
  if (data.session) start();
  else showLogin();
})();
