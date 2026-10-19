// Calendario de fechas libres (booking.html). Los días ocupados los carga Manu en la tabla
// booking_busy de Supabase; la web solo ve las fechas (RPC public_busy_days, sin notas).
// Si no se puede leer, el calendario no se muestra (mejor nada que mostrar todo libre por error).
// Tocar un día libre abre el formulario con la fecha ya escrita en el mensaje.
import { lang } from "../core/i18n.js";

const MONTHS_AHEAD = 3;
const T = {
  es: { pick: (d) => `Fecha que me interesa: ${d}. `, prev: "Mes anterior", next: "Mes siguiente", busy: "ocupada", free: "libre" },
  en: { pick: (d) => `Date I'm interested in: ${d}. `, prev: "Previous month", next: "Next month", busy: "booked", free: "available" },
}[lang];
const LOCALE = lang === "en" ? "en-US" : "es-AR";

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

async function fetchBusy(from, to) {
  const cfg = window.MP_SUPABASE || {};
  if (!cfg.url || !cfg.anonKey) throw new Error("no_config");
  const res = await fetch(`${cfg.url}/rest/v1/rpc/public_busy_days`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}` },
    body: JSON.stringify({ p_from: iso(from), p_to: iso(to) }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const rows = await res.json();
  return new Set(rows.map((r) => (typeof r === "string" ? r : r.public_busy_days)));
}

export async function initBookingCalendar() {
  const root = document.querySelector("[data-busy-cal]");
  if (!root) return;
  const grid = root.querySelector("[data-cal-grid]");
  const label = root.querySelector("[data-cal-month]");
  const prev = root.querySelector("[data-cal-prev]");
  const next = root.querySelector("[data-cal-next]");
  prev.setAttribute("aria-label", T.prev);
  next.setAttribute("aria-label", T.next);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const last = new Date(today.getFullYear(), today.getMonth() + MONTHS_AHEAD, 0);

  let busy;
  try {
    busy = await fetchBusy(today, last);
  } catch (e) {
    console.warn("[calendario] sin datos de fechas:", e.message);
    return;
  }

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(2024, 0, 1 + i).toLocaleDateString(LOCALE, { weekday: "narrow" })); // 1/1/2024 fue lunes
  let offset = 0;

  const render = () => {
    const month = new Date(first.getFullYear(), first.getMonth() + offset, 1);
    label.textContent = month.toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
    prev.disabled = offset === 0;
    next.disabled = offset === MONTHS_AHEAD - 1;
    const lead = (month.getDay() + 6) % 7; // semana arranca el lunes
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    let html = weekdays.map((w) => `<span class="bk-cal__wd" aria-hidden="true">${w}</span>`).join("");
    html += Array.from({ length: lead }, () => `<span></span>`).join("");
    for (let n = 1; n <= days; n++) {
      const d = new Date(month.getFullYear(), month.getMonth(), n);
      const key = iso(d);
      const past = d < today;
      const isBusy = busy.has(key);
      const long = d.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" });
      const weekend = d.getDay() === 5 || d.getDay() === 6;
      if (past) html += `<span class="bk-cal__day is-past" aria-hidden="true">${n}</span>`;
      else if (isBusy) html += `<span class="bk-cal__day is-busy" role="img" aria-label="${long}: ${T.busy}">${n}</span>`;
      else html += `<button type="button" class="bk-cal__day is-free${weekend ? " is-weekend" : ""}" data-day="${key}" aria-label="${long}: ${T.free}">${n}</button>`;
    }
    grid.innerHTML = html;
  };

  prev.addEventListener("click", () => { if (offset > 0) { offset--; render(); } });
  next.addEventListener("click", () => { if (offset < MONTHS_AHEAD - 1) { offset++; render(); } });
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn) return;
    const [y, m, d] = btn.dataset.day.split("-").map(Number);
    const long = new Date(y, m - 1, d).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" });
    grid.querySelectorAll(".is-picked").forEach((b) => b.classList.remove("is-picked"));
    btn.classList.add("is-picked");
    const msg = document.getElementById("cf-message");
    if (msg) {
      const clean = msg.value.replace(/^(Fecha que me interesa|Date I'm interested in): [^.]*\. /, "");
      msg.value = T.pick(long) + clean;
    }
    const open = document.querySelector("[data-booking-open]");
    const panel = document.querySelector("[data-booking-panel]");
    if (open && panel?.hidden) open.click();
    else panel?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  render();
  root.hidden = false;
}
