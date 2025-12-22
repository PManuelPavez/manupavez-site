import { $ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getReleases, getLabels, getMedia } from "../data/content.js";
import { renderReleases, renderLabels, renderMedia } from "../ui/renderers.js";
import { initReleaseSlider, initMediaSliders } from "../features/slider.js";
import { bindReleaseModal } from "../features/releaseModal.js";

export function initHome() {
  const releasesRoot = $("[data-sb='releases']") || $("[data-sb-releases]");
  const labelsTrack = $("[data-sb='labels-track']");
  const videoRoot = $("[data-sb='media-video']");
  const mixRoot = $("[data-sb='media-mix']");

  // Si no hay nada de lo que hidratamos, salimos.
  if (!releasesRoot && !labelsTrack && !videoRoot && !mixRoot) return;

  if (!hasSupabase()) {
    console.warn("[home] Supabase no configurado: usando contenido estático.");
    return;
  }

  if (releasesRoot) hydrateReleases(releasesRoot);
  if (labelsTrack) hydrateLabels(labelsTrack);
  if (videoRoot) hydrateMedia(videoRoot, "videos");
  if (mixRoot) hydrateMedia(mixRoot, "mixes");
}

async function hydrateReleases(root) {
  try {
    root.setAttribute("data-loading", "true");
    const releases = await getReleases();
    renderReleases(root, releases);

    // Modal de detalle (portada + links)
    const byId = new Map();
    releases.forEach((r, idx) => byId.set(String(r.id ?? r.slug ?? idx), r));
    bindReleaseModal(root, (id) => byId.get(String(id)));

    // Re-init del slider una vez que existen .release-slide
    initReleaseSlider();
  } catch (e) {
    console.error("[home] releases hydrate error:", e);
  } finally {
    root.removeAttribute("data-loading");
  }
}

async function hydrateLabels(track) {
  try {
    track.setAttribute("data-loading", "true");
    const labels = await getLabels();
    renderLabels(track, labels);
  } catch (e) {
    console.error("[home] labels hydrate error:", e);
  } finally {
    track.removeAttribute("data-loading");
  }
}

async function hydrateMedia(root, kind) {
  try {
    root.setAttribute("data-loading", "true");
    const items = await getMedia(kind);
    renderMedia(root, items, kind === "mixes" ? "mix" : "video");
    // Re-init sliders cuando entran embeds
    initMediaSliders();
  } catch (e) {
    console.error("[home] media hydrate error:", kind, e);
  } finally {
    root.removeAttribute("data-loading");
  }
}
