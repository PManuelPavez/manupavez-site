import { $ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getReleases, getLabels, getMedia, getReleasesJson, getYouTubeVideos } from "../data/content.js";
import { renderReleases, renderLabels, renderMedia } from "../ui/renderers.js";
import { initReleaseSlider, initMediaSliders } from "../features/slider.js";
import { bindReleaseModal } from "../features/releaseModal.js";

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export function initHome() {
  const releasesRoot = $("[data-sb='releases']") || $("[data-sb-releases]");
  const labelsTrack = $("[data-sb='labels-track']") || $("[data-sb-labels-track]");
  const videoRoot = $("[data-sb='media-video']") || $("[data-sb-media-video]");
  const mixRoot = $("[data-sb='media-mix']") || $("[data-sb-media-mix]");

  // Si no hay nada de lo que hidratamos, salimos.
  if (!releasesRoot && !labelsTrack && !videoRoot && !mixRoot) return;

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

    // 1) JSON estático (data/music.json, auto-sync Spotify) — sin mantenimiento
    let releases = await getReleasesJson();
    // 2) Fallback a Supabase si el JSON aún no existe
    if (!releases.length && hasSupabase()) {
      releases = await getReleases();
    }
    renderReleases(root, releases);

    // Modal de detalle (portada + links)
    const byId = new Map();
    releases.forEach((r, idx) => byId.set(String(r.id ?? r.slug ?? idx), r));
    bindReleaseModal(root, (id) => byId.get(String(id)));

    // Marcar hidratado antes de re-init
    root.setAttribute("data-hydrated", "true");

    // Re-init del slider una vez que existen .release-slide y el layout está listo
    await nextFrame();
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
