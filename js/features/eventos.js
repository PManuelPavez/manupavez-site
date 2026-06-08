import { $ } from "../core/dom.js";

/**
 * Fechas en vivo dinámicas.
 * Lee /eventos.json (generado por automation.py desde Google Sheets) y
 * renderiza la lista de próximas fechas en el contenedor [data-eventos].
 *
 * Estructura esperada de cada evento:
 *   { "fecha": "...", "lugar": "...", "ciudad": "...", "tickets": "..." | null }
 */

// Escape básico para no inyectar HTML crudo desde la planilla.
function esc(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Convierte el texto de la planilla en un Date LOCAL (sin corrimiento por UTC).
// Soporta "YYYY-MM-DD" y "DD/MM/YYYY". Devuelve null si no reconoce el formato.
function aDateLocal(fecha) {
  const txt = String(fecha ?? "").trim();
  let m = txt.match(/^(\d{4})-(\d{2})-(\d{2})$/); // YYYY-MM-DD
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = txt.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); // DD/MM/YYYY
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

// Formatea la fecha a algo legible (ej: "15 jul 2026"); si no parsea, deja el texto original.
function formatearFecha(fecha) {
  const d = aDateLocal(fecha);
  if (!d) return esc(fecha);
  return d.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function plantillaEvento(ev) {
  const fecha = formatearFecha(ev.fecha);
  const lugar = esc(ev.lugar);
  const ciudad = esc(ev.ciudad);
  const cta = ev.tickets
    ? `<a class="mp-btn primary show-cta" href="${esc(ev.tickets)}" target="_blank" rel="noopener">TICKETS</a>`
    : `<span class="muted show-soon">Próximamente</span>`;

  // OJO: NO ponemos la clase `reveal` acá porque la inyección ocurre DESPUÉS
  // del init de scrollytelling.js (que escanea `.reveal` al cargar la página).
  // Las filas se animan con el IntersectionObserver de revelarFilas() abajo.
  return `
    <article class="show-row">
      <span class="show-date">${fecha}</span>
      <span class="show-venue">${lugar}${ciudad ? ` · ${ciudad}` : ""}</span>
      ${cta}
    </article>`;
}

// Anima las filas recién inyectadas con un fade-up sutil.
// Usamos IntersectionObserver (NO ScrollTrigger) porque las filas se inyectan
// DESPUÉS del init de GSAP: al crear un trigger con `toggleActions: play none none none`
// si ya estás dentro del viewport, no auto-dispara el "enter" y la fila se queda
// en opacity 0. IO sí maneja correctamente el caso "ya estoy adentro al registrarme".
function revelarFilas(cont) {
  const filas = [...cont.querySelectorAll(".show-row")];
  if (!filas.length) return;

  const { gsap, ScrollTrigger } = window;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  // Fallback: sin GSAP, con reduce-motion o sin IO → todo visible, sin animar.
  if (!gsap || reduce || !("IntersectionObserver" in window)) {
    filas.forEach((f) => f.classList.add("is-visible"));
    return;
  }

  // Estado inicial: ocultas y un poco desplazadas hacia abajo.
  gsap.set(filas, { autoAlpha: 0, y: 32 });

  // Stagger según el orden en que cada fila entra al viewport.
  let revealCount = 0;
  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        gsap.to(entry.target, {
          autoAlpha: 1,
          y: 0,
          duration: 0.7,
          ease: "power2.out",
          delay: revealCount++ * 0.08,
          onComplete: () => entry.target.classList.add("is-visible"),
        });
        obs.unobserve(entry.target);
      }
    },
    { threshold: 0.15 }
  );

  filas.forEach((f) => io.observe(f));

  // Recalcular triggers del resto del sitio (el alto del DOM cambió).
  ScrollTrigger?.refresh();
}

export async function initEventos() {
  const cont = $("[data-eventos]");
  if (!cont) return;

  try {
    // cache:no-cache para tomar siempre el eventos.json más reciente.
    const res = await fetch("eventos.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const eventos = await res.json();

    if (!Array.isArray(eventos) || eventos.length === 0) {
      cont.innerHTML = `<p class="muted">Pronto nuevas fechas. Seguime para no perderte ninguna.</p>`;
      return;
    }

    cont.innerHTML = eventos.map(plantillaEvento).join("");

    // Las filas se inyectan DESPUÉS del init de GSAP, así que su fade-up no se
    // registró en scrollytelling.js. Lo creamos acá explícitamente.
    revelarFilas(cont);
  } catch (error) {
    cont.innerHTML = `<p class="muted">No se pudieron cargar las fechas por ahora.</p>`;
    console.error("[eventos]", error);
  }
}
