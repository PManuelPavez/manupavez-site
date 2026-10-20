// puerta.js — Control de ingreso para seguridad (/puerta).
// Entra con un código de 4 números que Manu crea en /ventas. La sesión dura 16 h en este celular.
// Lista + buscador local (instantáneo); cada INGRESÓ se confirma en el servidor (door_checkin):
// si otro celular ya lo marcó, avisa con la hora y quién. La lista se refresca sola cada 15 s.

const cfg = window.MP_SUPABASE || {};
const TOKEN_KEY = "mp_door";
const REFRESH_MS = 15_000;

const $ = (s, el = document) => el.querySelector(s);
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const hhmm = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });

let token = null;
let people = [];
let filter = "pending";
let timer = null;

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
  clearInterval(timer);
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

// ---------- Lista ----------
async function load() {
  let data;
  try { data = await rpc("door_list", { p_token: token }); }
  catch { return; } // sin señal: se queda con la última lista
  if (data?.error === "session") return logout("La sesión venció o el código se desactivó. Pedí uno nuevo.");
  people = (data.people || []).map((p) => ({ ...p, key: norm(`${p.name} ${p.buyer} ${p.code}`) }));
  $("[data-event]").textContent = `${data.event?.name || ""} · ${data.label || ""}`;
  render();
}

function render() {
  const total = people.length;
  const inside = people.filter((p) => p.in_at).length;
  $("[data-in]").textContent = inside;
  $("[data-total]").textContent = total;

  const q = norm($("[data-q]").value);
  $("[data-clear]").hidden = !q;
  const words = q.split(" ").filter(Boolean);
  let list = people.filter((p) => words.every((w) => p.key.includes(w)));
  if (filter === "pending") list = list.filter((p) => !p.in_at);
  if (filter === "in") list = list.filter((p) => p.in_at).sort((a, b) => b.in_at.localeCompare(a.in_at));

  // Sin búsqueda en "Faltan" con lista larga: mostramos un tope para no hacer scroll infinito
  const MAX = 60;
  const shown = list.slice(0, q ? 100 : MAX);
  $("[data-hint]").hidden = Boolean(q) || filter !== "pending";
  const ul = $("[data-list]");
  if (!shown.length) {
    ul.innerHTML = `<li class="pt-empty">${q ? "No hay nadie con ese nombre en esta lista." : filter === "in" ? "Todavía no entró nadie." : "No falta nadie. 🎉"}</li>`;
    return;
  }
  const groups = new Map();
  for (const p of people) groups.set(p.code, [...(groups.get(p.code) || []), p]);

  ul.replaceChildren(...shown.map((p) => {
    const li = document.createElement("li");
    li.className = `pt-person${p.in_at ? " is-in" : ""}`;
    const name = document.createElement("p");
    name.className = "pt-person__name";
    name.textContent = p.name;
    const meta = document.createElement("p");
    meta.className = "pt-person__meta";
    meta.textContent = `${p.tier || ""} · Compra ${p.code}${p.buyer && norm(p.buyer) !== norm(p.name) ? ` de ${p.buyer}` : ""}`;
    li.append(name, meta);

    if (p.in_at) {
      const box = document.createElement("div");
      box.className = "pt-person__in";
      box.innerHTML = `✓ ADENTRO<small></small>`;
      box.querySelector("small").textContent = `${hhmm(p.in_at)}${p.in_by ? ` · ${p.in_by}` : ""}`;
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "pt-person__undo";
      undo.textContent = "Deshacer";
      undo.addEventListener("click", () => {
        if (confirm(`¿Sacar a ${p.name} de "adentro"? Usalo solo si lo marcaste por error.`)) checkin(p, true);
      });
      box.append(undo);
      li.append(box);
    } else {
      const go = document.createElement("button");
      go.type = "button";
      go.className = "pt-person__go";
      go.textContent = "INGRESÓ";
      go.addEventListener("click", () => checkin(p, false, go));
      li.append(go);
      const pending = (groups.get(p.code) || []).filter((x) => !x.in_at);
      if (pending.length > 1) {
        const all = document.createElement("button");
        all.type = "button";
        all.className = "pt-group";
        all.textContent = `Ingresan todos los de esta compra (${pending.length})`;
        all.addEventListener("click", () => checkinGroup(pending, all));
        li.append(all);
      }
    }
    return li;
  }));
}

async function checkin(p, undo = false, btn = null) {
  if (btn) btn.disabled = true;
  let r;
  try { r = await rpc("door_checkin", { p_token: token, p_attendee: p.id, p_undo: undo }); }
  catch {
    if (btn) btn.disabled = false;
    return toast("Sin conexión. Probá de nuevo.", "bad");
  }
  if (r?.error === "session") return logout("La sesión venció. Volvé a ingresar el código.");
  if (r?.error) { if (btn) btn.disabled = false; return toast("No se encontró en la lista.", "bad"); }

  if (r.result === "already") {
    p.in_at = r.in_at; p.in_by = r.in_by;
    toast(`⚠ ${p.name} YA INGRESÓ a las ${hhmm(r.in_at)}${r.in_by ? ` (${r.in_by})` : ""}`, "warn");
  } else if (r.result === "undone") {
    p.in_at = null; p.in_by = null;
    toast(`${p.name} quedó como pendiente`, "warn");
  } else {
    p.in_at = r.in_at; p.in_by = r.in_by;
    toast(`✓ ${p.name} adentro`);
    // Listo para el próximo: búsqueda limpia y teclado arriba
    const q = $("[data-q]");
    if (q.value) { q.value = ""; }
    q.focus();
  }
  render();
}

async function checkinGroup(list, btn) {
  btn.disabled = true;
  let ok = 0;
  const already = [];
  for (const p of list) {
    try {
      const r = await rpc("door_checkin", { p_token: token, p_attendee: p.id, p_undo: false });
      if (r?.error === "session") return logout("La sesión venció. Volvé a ingresar el código.");
      if (r?.result === "ok") { p.in_at = r.in_at; p.in_by = r.in_by; ok++; }
      else if (r?.result === "already") { p.in_at = r.in_at; p.in_by = r.in_by; already.push(p.name); }
    } catch { /* sigue con el resto */ }
  }
  if (already.length) toast(`✓ ${ok} adentro · ⚠ ya habían ingresado: ${already.join(", ")}`, "warn");
  else toast(`✓ ${ok} adentro`);
  $("[data-q]").value = "";
  render();
}

// ---------- Inicio ----------
function startApp() {
  $("[data-login]").hidden = true;
  $("[data-app]").hidden = false;
  load();
  clearInterval(timer);
  timer = setInterval(load, REFRESH_MS);
  $("[data-q]").focus();
}

$("[data-login-form]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("#pt-code").value.trim();
  const msg = $("[data-login-msg]");
  if (!/^\d{4}$/.test(code)) { msg.textContent = "El código tiene 4 números."; return; }
  msg.textContent = "Verificando…";
  let r;
  try { r = await rpc("door_login", { p_code: code }); }
  catch { msg.textContent = "Sin conexión. Probá de nuevo."; return; }
  if (r?.token) {
    token = r.token;
    saveToken(token);
    msg.textContent = "";
    startApp();
    return;
  }
  $("#pt-code").value = "";
  if (r?.error === "locked") msg.textContent = r.scope === "global" ? "Acceso pausado por seguridad. Avisale a Manu." : "Demasiados intentos. Esperá 15 minutos.";
  else msg.textContent = r?.remaining > 0 ? `Código incorrecto. Te quedan ${r.remaining} intentos.` : "Código incorrecto.";
});
$("#pt-code").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
  if (e.target.value.length === 4) $("[data-login-form]").requestSubmit();
});

$("[data-q]").addEventListener("input", render);
$("[data-clear]").addEventListener("click", () => { $("[data-q]").value = ""; render(); $("[data-q]").focus(); });
document.querySelectorAll("[data-filter]").forEach((b) => b.addEventListener("click", () => {
  filter = b.dataset.filter;
  document.querySelectorAll("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  render();
}));
$("[data-logout]").addEventListener("click", () => { if (confirm("¿Salir de la puerta en este celular?")) logout(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden && token) load(); });

token = readToken();
if (token) startApp();
else { $("[data-login]").hidden = false; $("#pt-code").focus(); }
