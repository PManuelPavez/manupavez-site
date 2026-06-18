// js/features/liveSets.js
// Acordeón de la sección Live Sets (estilo Nacho Scoppa).
// Click en un trigger abre su panel y cierra los demás. El hover (CSS) ya
// muestra la preview; acá manejamos el estado "abierto" persistente y el aria.

export function initLiveSets() {
  const list = document.querySelector("[data-sb='live-sets']");
  if (!list) return;

  // Delegación: el contenido se renderiza async desde content.js
  list.addEventListener("click", (e) => {
    const trigger = e.target.closest("[data-live-trigger]");
    if (!trigger || !list.contains(trigger)) return;

    const row = trigger.closest("[data-live-row]");
    if (!row) return;

    const willOpen = !row.classList.contains("is-open");

    // Cerrar el resto
    list.querySelectorAll("[data-live-row].is-open").forEach((r) => {
      if (r !== row) {
        r.classList.remove("is-open");
        const t = r.querySelector("[data-live-trigger]");
        if (t) t.setAttribute("aria-expanded", "false");
      }
    });

    row.classList.toggle("is-open", willOpen);
    trigger.setAttribute("aria-expanded", String(willOpen));
  });
}
