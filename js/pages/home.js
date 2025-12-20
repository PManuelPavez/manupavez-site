import { $ } from "../core/dom.js";
import { prefersReducedMotion } from "../core/motion.js";
import { hasSupabase, waitForSupabase } from "../data/supabaseClient.js";
import { getReleases, getLabels, getMedia } from "../data/content.js";
import { renderReleases, renderLabels, renderMedia } from "../ui/renderers.js";
import { initSliders } from "../features/slider.js";
import { initReveal } from "../features/reveal.js";
import { bindReleaseModal } from "../features/releaseModal.js";

export function initHome() {
  // Hooks (DOM-driven)
  const releasesRoot = document.querySelector('[data-sb="releases"]') || $("[data-sb-releases]");
  const labelsTrack = document.querySelector('[data-sb="labels-track"]') || $("[data-sb-labels-track]");

  // Estos suelen ser sliders con track adentro
  const mixesRoot =
    document.querySelector('[data-sb="media-mixes"]') ||
    document.querySelector('[data-sb="media-mix"]') ||
    $("[data-sb-media-mix]");

  const videosRoot =
    document.querySelector('[data-sb="media-videos"]') ||
    document.querySelector('[data-sb="media-video"]') ||
    $("[data-sb-media-video]");

  if (!releasesRoot && !labelsTrack && !mixesRoot && !videosRoot) return;

  if (!hasSupabase()) {
    // Por si el config se carga después (orden raro en el HTML)
    waitForSupabase().then((sb) => {
      if (!sb) return;
      hydrate({ releasesRoot, labelsTrack, mixesRoot, videosRoot });
    });
    return;
  }

  hydrate({ releasesRoot, labelsTrack, mixesRoot, videosRoot });
}

async function hydrate({ releasesRoot, labelsTrack, mixesRoot, videosRoot }) {
  const jobs = [];

  // Releases (covers only + modal + marquee)
  if (releasesRoot) {
    jobs.push(
      (async () => {
        const raw = await getReleases();
        const releases = (raw || []).map((r, idx) => ({
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

  // Labels
  if (labelsTrack) {
    jobs.push(
      (async () => {
        const labels = await getLabels();
        renderLabels(labelsTrack, labels || []);
      })()
    );
  }

  // Mixes
  if (mixesRoot) {
    jobs.push(
      (async () => {
        const mixes = await getMedia("mix");
        renderMedia(mixesRoot, mixes || [], "mix");
      })()
    );
  }

  // Videos
  if (videosRoot) {
    jobs.push(
      (async () => {
        const videos = await getMedia("video");
        renderMedia(videosRoot, videos || [], "video");
      })()
    );
  }

  const results = await Promise.allSettled(jobs);
  results.forEach((r) => {
    if (r.status === "rejected") console.warn("[home] hydrate section error:", r.reason);
  });

  // Re-init: ahora que hay DOM nuevo
  initReveal();
  initSliders();
}

function enableReleaseMarquee(releasesRoot) {
  // Reduced motion => no marquee
  if (prefersReducedMotion()) return;

  const slider = releasesRoot.closest(".release-slider") || document.querySelector(".release-slider");
  if (!slider) return;

  // Track: si tenés un track explícito, mejor.
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

    // A11y: clones no deberían ser focusables ni “leídos”
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
