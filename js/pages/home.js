import { $ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getReleases, getLabels, getMedia } from "../data/content.js";
import { renderReleases, renderLabels, renderMedia } from "../ui/renderers.js";
import { initReleaseSlider, initMediaSliders } from "../features/slider.js";
import { pageName, showSupabaseBanners } from "./_common.js";

export function initHome() {
  if (pageName() !== "home") return;

  if (!hasSupabase()) {
    showSupabaseBanners();
    return;
  }

  hydrate();
}

async function hydrate() {
  try {
    const [releases, labels, videos, mixes] = await Promise.all([
      getReleases(),
      getLabels(),
      getMedia("video"),
      getMedia("mix"),
    ]);

    const releasesRoot = $("[data-sb='releases']");
    if (releasesRoot) {
      renderReleases(releasesRoot, releases);
      initReleaseSlider();
    }

    const labelsTrack = $("[data-sb='labels-track']");
    if (labelsTrack) renderLabels(labelsTrack, labels);

    const videoRoot = $("[data-sb='media-video']");
    if (videoRoot) {
      renderMedia(videoRoot, videos, "video");
      initMediaSliders();
    }

    const mixRoot = $("[data-sb='media-mix']");
    if (mixRoot) {
      renderMedia(mixRoot, mixes, "mix");
      initMediaSliders();
    }
  } catch (e) {
    console.warn("[home] Supabase hydrate error:", e);
    showSupabaseBanners();
  }
}
