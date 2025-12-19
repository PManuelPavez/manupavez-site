import { $ } from "../core/dom.js";
import { prefersReducedMotion } from "../core/motion.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getReleases } from "../data/content.js";
import { renderReleases } from "../ui/renderers.js";
import { bindReleaseModal } from "../features/releaseModal.js";

export function initHome() {
  // Soporta ambos: el nuevo pedido y el selector viejo
  const container = document.querySelector('[data-sb="releases"]') || $("[data-sb-releases]");
  if (!container) return;

  if (!hasSupabase()) {
    console.warn("[home] Supabase no configurado: usando contenido estático.");
    return;
  }

  hydrate(container);
}

async function hydrate(container) {
  try {
    container.setAttribute("data-loading", "true");

    const releasesRaw = await getReleases();

    // Normalizamos id estable para modal + dataset
    const releases = releasesRaw.map((r, idx) => ({
      ...r,
      __mp_id: String(r.id ?? r.slug ?? r.key ?? idx),
    }));

    // Render (con #tpl-release)
    renderReleases(container, releases, { mode: container.getAttribute("data-sb-mode") || "replace" });

    // Bind modal (delegado)
    const byId = new Map(releases.map((r) => [String(r.__mp_id), r]));
    bindReleaseModal(container, (id) => byId.get(String(id)));

    // Marquee infinito “real”
    enableReleaseMarquee(container);

  } catch (e) {
    console.error("[home] Supabase hydrate error:", e);
    container.textContent = "No se pudo cargar contenido (mirá consola).";
  } finally {
    container.removeAttribute("data-loading");
  }
}

function enableReleaseMarquee(container) {
  if (prefersReducedMotion()) return;

  const slider = container.closest(".release-slider") || document.querySelector(".release-slider");
  if (!slider) return;

  // Track: intenta encontrar el track real; si no, usa container como track
  const track =
    slider.querySelector("[data-slider-track]") ||
    slider.querySelector(".release-track") ||
    container;

  // Evitar duplicación múltiple
  if (slider.dataset.marqueeReady === "true") return;

  const children = Array.from(track.children);
  if (children.length < 2) return;

  const frag = document.createDocumentFragment();

  children.forEach((child) => {
    const clone = child.cloneNode(true);

    // A11y: evitar duplicar tab stops / screen reader spam
    clone.setAttribute("aria-hidden", "true");
    clone.querySelectorAll("a, button, input, select, textarea, [tabindex]").forEach((el) => {
      el.setAttribute("tabindex", "-1");
    });

    frag.appendChild(clone);
  });

  track.appendChild(frag);

  slider.setAttribute("data-marquee", "true");
  slider.dataset.marqueeReady = "true";
}
