import { $ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getReleases, getLabels, getMedia, getReleasesJson, getYouTubeVideos, getLiveSets } from "../data/content.js";
import { renderReleases, renderLabels, renderMedia, renderLiveSets } from "../ui/renderers.js";
import { initMediaSliders } from "../features/slider.js";
import { initLiveSets } from "../features/liveSets.js";
import { staggerReveal } from "../features/scrollytelling.js";
import { enhanceReleaseSlider } from "../features/releaseSlider.js";
import { initCdModal } from "../features/cdModal.js";

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export function initHome() {
  const releasesRoot = $("[data-sb='releases']") || $("[data-sb-releases]");
  const labelsTrack = $("[data-sb='labels-track']") || $("[data-sb-labels-track]");
  const videoRoot = $("[data-sb='media-video']") || $("[data-sb-media-video]");
  const mixRoot = $("[data-sb='media-mix']") || $("[data-sb-media-mix]");
  const liveSetsRoot = $("[data-sb='live-sets']");

  // Si no hay nada de lo que hidratamos, salimos.
  if (!releasesRoot && !labelsTrack && !videoRoot && !mixRoot && !liveSetsRoot) return;

  // Nota: releases y videos pueden venir de JSON estático (data/*.json) sin Supabase.
  // Sólo labels y mixes dependen de Supabase.
  if (!hasSupabase()) {
    console.warn("[home] Supabase no configurado — uso fuentes JSON locales donde se pueda");
  }

  // No bloqueamos la carga: corremos async sin exigir que el caller "await".
  void (async () => {
    const tasks = [];

    // Releases: JSON (Spotify sync) primero, Supabase como fallback
    if (releasesRoot && !releasesRoot.hasAttribute("data-hydrated")) {
      tasks.push(hydrateReleases(releasesRoot));
    }

    // Labels: solo Supabase
    if (hasSupabase() && labelsTrack && !labelsTrack.hasAttribute("data-hydrated")) {
      tasks.push(hydrateLabels(labelsTrack));
    }

    // Live sets: JSON estático (data/youtube.json, auto-sync RSS)
    if (liveSetsRoot && !liveSetsRoot.hasAttribute("data-hydrated")) {
      tasks.push(hydrateLiveSets(liveSetsRoot));
    }

    // Media: hidratamos ambos y recién al final inicializamos sliders UNA vez
    const mediaTasks = [];
    // Videos: JSON (YouTube RSS) primero, Supabase como fallback
    if (videoRoot && !videoRoot.hasAttribute("data-hydrated")) {
      mediaTasks.push(hydrateMedia(videoRoot, "videos", { initSliders: false }));
    }
    // Mixes: solo Supabase
    if (hasSupabase() && mixRoot && !mixRoot.hasAttribute("data-hydrated")) {
      mediaTasks.push(hydrateMedia(mixRoot, "mixes", { initSliders: false }));
    }

    // Esperamos todo (media incluida)
    await Promise.all([...tasks, ...mediaTasks]);

    // Re-init sliders cuando ya está todo en el DOM y layout calculado
    if (mediaTasks.length) {
      await nextFrame();
      initMediaSliders();
    }
  })();
}

async function hydrateReleases(root) {
  try {
    root.setAttribute("data-loading", "true");

    // 1) Supabase (home_releases) es la fuente curada de releases.
    let releases = [];
    if (hasSupabase()) {
      try {
        releases = await getReleases();
      } catch (e) {
        console.warn("[home] releases Supabase error, pruebo JSON:", e);
      }
    }
    // 2) Fallback a JSON estático (data/music.json) si Supabase no devolvió nada.
    if (!releases.length) {
      releases = await getReleasesJson();
    }

    // Render como slider de portadas (estilo discografía). Cada card linkea
    // directo a Spotify, así que no hace falta modal.
    renderReleases(root, releases);
    root.setAttribute("data-hydrated", "true");

    await nextFrame();
    enhanceReleaseSlider(root);
    initCdModal();
    staggerReveal(root.querySelectorAll(".track-card"), { trigger: root, start: "top 90%" });
  } catch (e) {
    console.error("[home] releases hydrate error:", e);
  } finally {
    root.removeAttribute("data-loading");
  }
}

async function hydrateLiveSets(root) {
  try {
    root.setAttribute("data-loading", "true");
    const sets = await getLiveSets();
    renderLiveSets(root, sets);
    root.setAttribute("data-hydrated", "true");

    const count = document.querySelector("[data-live-count]");
    if (count && sets.length) count.textContent = `(${String(sets.length).padStart(2, "0")})`;

    await nextFrame();
    initLiveSets();
    staggerReveal(root.querySelectorAll(".live-sets__item"), { trigger: root, start: "top 85%", stagger: 0.06 });
  } catch (e) {
    console.error("[home] live sets hydrate error:", e);
  } finally {
    root.removeAttribute("data-loading");
  }
}

async function hydrateLabels(track) {
  try {
    track.setAttribute("data-loading", "true");
    const labels = await getLabels();
    renderLabels(track, labels);

    track.setAttribute("data-hydrated", "true");
  } catch (e) {
    console.error("[home] labels hydrate error:", e);
  } finally {
    track.removeAttribute("data-loading");
  }
}

async function hydrateMedia(root, kind, opts = { initSliders: true }) {
  try {
    root.setAttribute("data-loading", "true");

    let items = [];
    if (kind === "videos") {
      // 1) JSON estático (data/youtube.json, auto-sync RSS) — sin mantenimiento
      items = await getYouTubeVideos();
      // 2) Fallback a Supabase
      if (!items.length && hasSupabase()) items = await getMedia(kind);
    } else {
      items = await getMedia(kind);
    }

    renderMedia(root, items, kind === "mixes" ? "mix" : "video");

    root.setAttribute("data-hydrated", "true");

    if (opts.initSliders) {
      await nextFrame();
      initMediaSliders();
    }
  } catch (e) {
    console.error("[home] media hydrate error:", kind, e);
  } finally {
    root.removeAttribute("data-loading");
  }
}
