// analytics.js — Visitas y clics con GoatCounter (sin cookies, sin cartel de aviso).
// Para activarlo: completar GOATCOUNTER con el código de la cuenta (lo que va antes de
// .goatcounter.com, ej. "manupavez"). Vacío = no se carga nada.
// Los clics importantes se cuentan como "eventos" (aparecen en el panel con su nombre).

const GOATCOUNTER = "";

const CLICKS = [
  ["[data-booking-open]", "booking-pedir-fecha"],
  ['a[href*="wa.me/"]', "booking-whatsapp"],
  ['[data-sb="presskit-download"]', "presskit-descarga"],
  ['a[href*="presskit"]', "presskit-ver"],
  [".bk-cal__day.is-free", "booking-calendario-dia"],
  ['a[href*="open.spotify.com"]', "spotify"],
  ['a[href*="instagram.com"]', "instagram"],
];

export function track(name) {
  try {
    window.goatcounter?.count?.({ path: name, title: name, event: true });
  } catch { /* nunca rompe la página */ }
}

export function initAnalytics() {
  if (!GOATCOUNTER || window.goatcounter?.loaded) return;
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = `https://${GOATCOUNTER}.goatcounter.com/count`;
  document.head.appendChild(s);

  document.addEventListener("click", (e) => {
    for (const [sel, name] of CLICKS) {
      if (e.target.closest(sel)) return track(name);
    }
  }, { capture: true });
}
