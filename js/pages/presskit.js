import { $, $$ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getPresskitPhotos, getPresskitDownload, getBlocks } from "../data/content.js";
import { renderPresskitPhotos, renderTextBlocks } from "../ui/renderers.js";
import { initPresskitPhotoSlider } from "../features/slider.js";

export function initPresskit() {
  // Hooks reales en presskit.html
  const slides = $("[data-sb='presskit-slides']") || $("[data-sb-presskit-photos]");
  const download = $("[data-sb='presskit-download']");
  const blockNodes = $$("[data-sb-block]");

  if (!slides && !download && !blockNodes.length) return;

  if (!hasSupabase()) {
    console.warn("[presskit] Supabase no configurado: usando contenido estático.");
    return;
  }

  if (slides) hydratePhotos(slides);
  if (download) hydrateDownload(download);
  if (blockNodes.length) hydrateBlocks(blockNodes);
}

async function hydratePhotos(slides) {
  try {
    slides.setAttribute("data-loading", "true");
    const photos = await getPresskitPhotos();
    renderPresskitPhotos(slides, photos, { mode: "replace" });
    initPresskitPhotoSlider();
  } catch (e) {
    console.error("[presskit] photos hydrate error:", e);
  } finally {
    slides.removeAttribute("data-loading");
  }
}

async function hydrateDownload(a) {
  try {
    const url = await getPresskitDownload();
    if (url) a.setAttribute("href", url);
  } catch (e) {
    console.error("[presskit] download hydrate error:", e);
  }
}

async function hydrateBlocks(nodes) {
  try {
    const keys = nodes.map((n) => n.getAttribute("data-sb-block")).filter(Boolean);
    const map = await getBlocks(keys);
    renderTextBlocks(nodes, map);
  } catch (e) {
    console.error("[presskit] blocks hydrate error:", e);
  }
}
