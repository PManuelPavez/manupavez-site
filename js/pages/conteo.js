// conteo.js — Link sin PIN con cuánta gente entró (/conteo.html?k=CLAVE). Para marketing.
// Solo muestra el evento y los números de ingreso (mismo "Adentro" del panel). Sin plata ni nombres.
// La clave la da el panel de ventas (botón LINK DE CONTEO). Se actualiza cada 10 s.
const cfg = window.MP_SUPABASE || {};
const KEY = new URLSearchParams(location.search).get("k") || "";
const REFRESH_MS = 10_000;

const $ = (s) => document.querySelector(s);
const num = (n) => Number(n || 0).toLocaleString("es-AR");
let timer = null;

async function load() {
  let d;
  try {
    const res = await fetch(`${cfg.url}/rest/v1/rpc/public_count`, {
      method: "POST",
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: KEY }),
    });
    if (!res.ok) throw new Error(String(res.status));
    d = await res.json();
  } catch {
    $("[data-note]").textContent = "Sin conexión. Reintentando…";
    return;
  }
  if (d?.error) {
    clearInterval(timer);
    $("[data-note]").textContent = "Este link no es válido o ya no está activo.";
    return;
  }
  const total = Number(d.total || 0);
  const guests = Number(d.guests || 0);
  const fecha = d.event?.date ? new Date(`${d.event.date}T12:00:00-03:00`).toLocaleDateString("es-AR", { day: "numeric", month: "long" }) : "";
  $("[data-event]").textContent = [d.event?.name, fecha, d.event?.venue].filter(Boolean).join(" · ");
  $("[data-total]").textContent = num(total);
  $("[data-paid]").textContent = num(Math.max(0, total - guests));
  $("[data-guests]").textContent = num(guests);
  $("[data-note]").textContent = ""; // sin hora, para que la captura quede limpia
}

if (!KEY) {
  $("[data-note]").textContent = "Este link no es válido o ya no está activo.";
} else {
  load();
  timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
}
