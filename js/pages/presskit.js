import { $ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getPresskitPhotos } from "../data/content.js";
import { renderPresskitPhotos } from "../ui/renderers.js";

export function initPresskit() {
  const container = $("[data-sb-presskit-photos]");
  if (!container) return; // DOM-driven

  if (!hasSupabase()) {
    console.warn("[presskit] Supabase no configurado: usando contenido estático.");
    return;
  }

  hydrate(container);
}

async function hydrate(container) {
  try {
    container.setAttribute("data-loading", "true");
    const photos = await getPresskitPhotos();
    renderPresskitPhotos(container, photos, { mode: container.getAttribute("data-sb-mode") || "replace" });
  } catch (e) {
    console.error("[presskit] Supabase hydrate error:", e);
    container.textContent = "No se pudo cargar contenido (mirá consola).";
  } finally {
    container.removeAttribute("data-loading");
  }
}
