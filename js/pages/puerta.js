// puerta.js — Control de ingreso (/puerta).
// Entra con un código de 6 números que Manu elige para cada persona en /ventas. La sesión dura 16 h.
// Manu también puede entrar con su PIN de admin (queda registrado como "Manu (admin)").
// La puerta NUNCA descarga la lista ni muestra totales: cada búsqueda va al servidor (door_search),
// que devuelve solo las coincidencias (mínimo 3 letras, máximo 8). Cada INGRESÓ se confirma en el
// servidor (door_checkin): si otro celular ya lo marcó, avisa con la hora. Deshacer solo desde /ventas.

import { mountTurnstile } from "../features/turnstile.js";

const cfg = window.MP_SUPABASE || {};
const SLUG = new URLSearchParams(location.search).get("evento") || "pergamino";
const TOKEN_KEY = "mp_door";
const DEBOUNCE_MS = 250;

const $ = (s, el = document) => el.querySelector(s);
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });

let token = null;
let results = [];
let seq = 0;          // descarta respuestas viejas si se escribe rápido
let debounce = null;

async function rpc(fn, args) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc_${res.status}`);
  return res.json();
}

// ---------- Sesión ----------
function saveToken(t) {
  try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ t, exp: Date.now() + 16 * 3600_000 })); } catch {}
}
function readToken() {
  try {
    const s = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
    return s && s.exp > Date.now() ? s.t : null;
  } catch { return null; }
}
function logout(msg = "") {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
  token = null;
  results = [];
  $("[data-list]").replaceChildren();
  $("[data-q]").value = "";
  $("[data-app]").hidden = true;
  $("[data-login]").hidden = false;
  $("[data-login-msg]").textContent = msg;
  $("#pt-code").value = "";
  $("#pt-code").focus();
}

// ---------- Aviso ----------
let toastTimer = null;
function toast(text, kind = "ok") {
  const el = $("[data-toast]");
  el.textContent = text;
  el.className = `pt-toast is-${kind}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), kind === "ok" ? 1800 : 4000);
  if (kind !== "ok") navigator.vibrate?.([120, 60, 120]);
  else navigator.vibrate?.(40);
}

// ---------- Búsqueda ----------
function hint(text) {
  $("[data-hint]").textContent = text;
  $("[data-hint]").hidden = !text;
}

async function search() {
  const q = $("[data-q]").value.trim();
  $("[data-clear]").hidden = !q;
  const mine = ++seq;
  if (q.replace(/\s/g, "").length < 3) {
    results = [];
    render();
    hint("Pedí el DNI y escribí nombre y apellido (mínimo 3 letras).");
    return;
  }
  let r;
  try { r = await rpc("door_search", { p_token: token, p_q: q }); }
  catch {
    if (mine === seq) hint("Sin conexión. Usá la lista en papel y avisale a Manu.");
    return;
  }
  if (mine !== seq) return;
  if (r?.error === "session") return logout("La sesión se cerró. Pedile a Manu un código.");
  results = r.people || [];
  if (r.more) hint("Hay muchas personas con eso. Escribí nombre y apellido completos.");
  else if (r.short) hint("Escribí al menos 3 letras.");
  else if (!results.length) hint("No está en la lista. Revisá cómo se escribe o pedí el código de compra que le llegó por mail.");
  else hint("");
  render();
}

function render() {
  const ul = $("[data-list]");
  ul.replaceChildren(...results.map((p) => {
    const li = document.createElement("li");
    li.className = `pt-person${p.in_at ? " is-in" : ""}`;
    const name = document.createElement("p");
    name.className = "pt-person__name";
    name.textContent = p.name;
    const meta = document.createElement("p");
    meta.className = "pt-person__meta";
    meta.textContent = `${p.tier || ""} · Compra ${p.code}${p.buyer ? ` de ${p.buyer}` : ""}`;
    li.append(name, meta);

    if (p.in_at) {
      const box = document.createElement("div");
      box.className = "pt-person__in";
      box.innerHTML = `✓ YA ENTRÓ<small></small>`;
      box.querySelector("small").textContent = `${hhmm(p.in_at)}${p.in_by ? ` · ${p.in_by}` : ""}`;
      li.append(box);
    } else {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "pt-person__go";
      go.textContent = "INGRESÓ";
      go.addEventListener("click", () => checkin(p, go));
      li.append(go);
    }
    return li;
  }));
}

async function checkin(p, btn) {
  btn.disabled = true;
  let r;
  try { r = await rpc("door_checkin", { p_token: token, p_attendee: p.id }); }
  catch {
    btn.disabled = false;
    return toast("Sin conexión. Probá de nuevo o usá la lista en papel.", "bad");
  }
  if (r?.error === "session") return logout("La sesión se cerró. Pedile a Manu un código.");
  if (r?.error) { btn.disabled = false; return toast("No se encontró en la lista.", "bad"); }

  p.in_at = r.in_at;
  p.in_by = r.in_by;
  if (r.result === "already") {
    toast(`⚠ ${p.name} YA ENTRÓ a las ${hhmm(r.in_at)}${r.in_by ? ` (${r.in_by})` : ""}`, "warn");
    render();
    return;
  }
  toast(`✓ ${p.name} adentro`);
  // Listo para el próximo: búsqueda limpia y teclado arriba
  $("[data-q]").value = "";
  results = [];
  render();
  hint("Pedí el DNI y escribí nombre y apellido (mínimo 3 letras).");
  $("[data-clear]").hidden = true;
  $("[data-q]").focus();
}

// ---------- Inicio ----------
async function startApp(label = "") {
  $("[data-login]").hidden = true;
  $("[data-app]").hidden = false;
  $("[data-event]").textContent = label;
  hint("Pedí el DNI y escribí nombre y apellido (mínimo 3 letras).");
  $("[data-q]").focus();
  // Confirma que la sesión sigue viva y trae el nombre del evento (sin personas)
  try {
    const d = await rpc("door_list", { p_token: token });
    if (d?.error === "session") return logout("La sesión se cerró. Pedile a Manu un código.");
    $("[data-event]").textContent = `${d.event?.name || ""} · ${d.label || ""}`;
  } catch { /* sin señal: se puede seguir intentando */ }
}

$("[data-login-form]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("#pt-code").value.trim();
  const msg = $("[data-login-msg]");
  if (!/^\d{6}$/.test(code)) { msg.textContent = "El código tiene 6 números."; return; }
  msg.textContent = "Verificando…";
  let r;
  try { r = await rpc("door_login", { p_code: code }); }
  catch { msg.textContent = "Sin conexión. Probá de nuevo."; return; }
  $("#pt-code").value = "";
  if (r?.token) {
    token = r.token;
    saveToken(token);
    msg.textContent = "";
    startApp(`${r.event || ""} · ${r.label || ""}`);
    return;
  }
  msg.textContent = "Código incorrecto.";
});
$("#pt-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
  if (e.target.value.length === 6) $("[data-login-form]").requestSubmit();
});

// ---------- Manu con PIN de admin ----------
// pin-login valida el PIN (Turnstile + límite de intentos) y devuelve una sesión de Supabase.
// Con esa sesión se pide una sesión de puerta (admin_door_open, la base verifica is_admin).
// La sesión de Supabase no se guarda: este celular queda solo con la sesión de puerta, igual que los demás.
const ADMIN_MSG = {
  invalid_format: "El PIN tiene 6 números.",
  network: "Sin conexión. Probá de nuevo.",
  captcha: "No se pudo verificar que no sos un robot. Esperá un segundo y probá de nuevo.",
  locked_ip: "Demasiados intentos. Esperá 15 minutos.",
  locked_global: "El acceso con PIN está pausado por seguridad. Usá un código de puerta.",
  not_admin: "Ese PIN no es de admin.",
  unavailable: "No se pudo entrar. Probá de nuevo en un momento.",
};
let captcha = null;

$("[data-admin-toggle]").addEventListener("click", async () => {
  const toAdmin = $("[data-admin-form]").hidden;
  $("[data-admin-form]").hidden = !toAdmin;
  $("[data-login-form]").hidden = toAdmin;
  $("[data-admin-toggle]").textContent = toAdmin ? "Volver al código de puerta" : "Soy Manu · entrar con PIN de admin";
  $("[data-login-intro]").textContent = toAdmin ? "Ingresá tu PIN de admin." : "Ingresá el código de 6 números que te pasaron.";
  $("[data-admin-msg]").textContent = "";
  $("[data-login-msg]").textContent = "";
  $(toAdmin ? "#pt-admin-pin" : "#pt-code").focus();
  if (toAdmin && !captcha) captcha = await mountTurnstile($("[data-captcha]"));
});

async function adminLogin(pin) {
  if (!/^\d{6}$/.test(pin)) return { message: ADMIN_MSG.invalid_format };
  let res, body = {};
  try {
    const cap = captcha ? await captcha.getToken() : "";
    res = await fetch(`${cfg.url}/functions/v1/pin-login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin, captcha: cap }),
    });
    body = await res.json().catch(() => ({}));
  } catch { return { message: ADMIN_MSG.network }; }
  finally { captcha?.reset(); }

  if (!res.ok || !body.access_token) {
    if (body.error === "locked") return { message: body.scope === "global" ? ADMIN_MSG.locked_global : ADMIN_MSG.locked_ip };
    if (body.error === "invalid") {
      const left = Number(body.remaining);
      return { message: left > 0 ? `PIN incorrecto. Te quedan ${left} ${left === 1 ? "intento" : "intentos"}.` : ADMIN_MSG.locked_ip };
    }
    return { message: ADMIN_MSG[body.error] || ADMIN_MSG.unavailable };
  }
  if (body.redirect !== "admin.html") return { message: ADMIN_MSG.not_admin };

  try {
    const r = await fetch(`${cfg.url}/rest/v1/rpc/admin_door_open`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${body.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_slug: SLUG }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok && d?.token) return { token: d.token, label: `${d.event || ""} · ${d.label || ""}` };
    return { message: r.status === 403 ? ADMIN_MSG.not_admin : ADMIN_MSG.unavailable };
  } catch { return { message: ADMIN_MSG.network }; }
}

$("[data-admin-form]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#pt-admin-pin");
  const msg = $("[data-admin-msg]");
  msg.textContent = "Verificando…";
  const r = await adminLogin(input.value.trim());
  input.value = "";
  if (!r.token) { msg.textContent = r.message; return; }
  token = r.token;
  saveToken(token);
  msg.textContent = "";
  $("[data-admin-form]").hidden = true;
  $("[data-login-form]").hidden = false;
  $("[data-admin-toggle]").textContent = "Soy Manu · entrar con PIN de admin";
  $("[data-login-intro]").textContent = "Ingresá el código de 6 números que te pasaron.";
  startApp(r.label);
});
$("#pt-admin-pin").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
  if (e.target.value.length === 6) $("[data-admin-form]").requestSubmit();
});

$("[data-q]").addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(search, DEBOUNCE_MS);
});
$("[data-clear]").addEventListener("click", () => { $("[data-q]").value = ""; search(); $("[data-q]").focus(); });
$("[data-logout]").addEventListener("click", () => { if (confirm("¿Salir de la puerta en este celular?")) logout(); });

token = readToken();
if (token) startApp();
else { $("[data-login]").hidden = false; $("#pt-code").focus(); }
