import { $ } from "../core/dom.js";
import { prefersReducedMotion } from "../core/motion.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getReleases, getLabels, getMedia } from "../data/content.js";
import { renderReleases, renderLabels, renderMedia } from "../ui/renderers.js";
import { getMedia } from "../data/content.js";
import { renderMedia } from "../ui/renderers.js";
import { initSliders } from "../features/slider.js";
import { initReveal } from "../features/reveal.js";
import { initSliders } from "../features/slider.js";
import { bindReleaseModal } from "../features/releaseModal.js";

export function initHome() {
  // DOM-driven: si hay hooks, es home (o al menos tiene secciones home).
  const releasesRoot = document.querySelector('[data-sb="releases"]') || $("[data-sb-releases]");
  const labelsTrack = document.querySelector('[data-sb="labels-track"]') || $("[data-sb-labels-track]");
  const mixesRoot =
    document.querySelector('[data-sb="media-mix"]') ||
    document.querySelector('[data-sb="media-mixes"]') ||
    $("[data-sb-media-mix]");
  const videosRoot =
    document.querySelector('[data-sb="media-video"]') ||
    document.querySelector('[data-sb="media-videos"]') ||
    $("[data-sb-media-video]");

  if (!releasesRoot && !labelsTrack && !mixesRoot && !videosRoot) return;

  if (!hasSupabase()) {
    console.warn("[home] Supabase no configurado: usando contenido estático.");
    return;
  }

  hydrate({ releasesRoot, labelsTrack, mixesRoot, videosRoot });
}

async function hydrate({ releasesRoot, labelsTrack, mixesRoot, videosRoot }) {
  const jobs = [];

  // Releases + modal + marquee
  if (releasesRoot) {
    jobs.push(
      (async () => {
        const releasesRaw = await getReleases();

        // id estable para modal
        const releases = releasesRaw.map((r, idx) => ({
          ...r,
          __mp_id: String(r.id ?? r.slug ?? r.key ?? idx),
        }));

        renderReleases(releasesRoot, releases, {
          mode: releasesRoot.getAttribute("data-sb-mode") || "replace",
        });

        const byId = new Map(releases.map((r) => [String(r.__mp_id), r]));
        bindReleaseModal(releasesRoot, (id) => byId.get(String(id)));

        enableReleaseMarquee(releasesRoot);
      })()
    );
  }

  // Labels (marquee tipo “real” ya lo hace renderLabels duplicando)
  if (labelsTrack) {
    jobs.push(
      (async () => {
        const labels = await getLabels();
        renderLabels(labelsTrack, labels);
      })()
    );
  }

  // Media mixes
  if (mixesRoot) {
    jobs.push(
      (async () => {
        const mixes = await getMedia("mix");
        renderMedia(mixesRoot, mixes, "mix");
      })()
    );
  }

  // Media videos
  if (videosRoot) {
    jobs.push(
      (async () => {
        const videos = await getMedia("video");
        renderMedia(videosRoot, videos, "video");
      })()
    );
  }

  const results = await Promise.allSettled(jobs);

  // Logueo útil (no “silencioso”)
  results.forEach((r) => {
    if (r.status === "rejected") console.warn("[home] hydrate section error:", r.reason);
  });

  // Re-init de reveals + sliders (porque ahora sí hay contenido)
  initReveal();
  initSliders();
}

function enableReleaseMarquee(releasesRoot) {
  if (prefersReducedMotion()) return;

  const slider = releasesRoot.closest(".release-slider") || document.querySelector(".release-slider");
  if (!slider) return;

  const track =
    slider.querySelector("[data-slider-track]") ||
    slider.querySelector(".release-track") ||
    releasesRoot;

  if (slider.dataset.marqueeReady === "true") return;

  const children = Array.from(track.children);
  if (children.length < 2) return;

  const frag = document.createDocumentFragment();

  children.forEach((child) => {
    const clone = child.cloneNode(true);

    // Evitar spam de foco/screen reader en clones
    clone.setAttribute("aria-hidden", "true");
    clone.querySelectorAll("a,button,input,select,textarea,[tabindex]").forEach((el) => {
      el.setAttribute("tabindex", "-1");
    });

    frag.appendChild(clone);
  });

  track.appendChild(frag);

  slider.setAttribute("data-marquee", "true");
  slider.dataset.marqueeReady = "true";
}
