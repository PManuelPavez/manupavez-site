import { $, $$ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getPresskitAssets, getPageBlocks } from "../data/content.js";
import { renderPresskitGallery, renderTextBlocks } from "../ui/renderers.js";
import { initPresskitPhotoSlider } from "../features/slider.js";
import { pageName, showSupabaseBanners } from "./_common.js";

export function initPresskit() {
  if (pageName() !== "presskit") return;

  if (!hasSupabase()) {
    showSupabaseBanners();
    return;
  }

  hydrate();
}

async function hydrate() {
  try {
    const slidesRoot = $("[data-sb='presskit-slides']");
    const dl = $("[data-sb='presskit-download']");
    const blockNodes = $$('[data-sb-block]');

    const keys = blockNodes.map((n) => n.getAttribute('data-sb-block')).filter(Boolean);
    // sumamos un key extra para link de descarga
    if (dl) keys.push('presskit_download_url');

    const [assets, blocks] = await Promise.all([
      getPresskitAssets(),
      getPageBlocks(keys),
    ]);

    if (slidesRoot) {
      renderPresskitGallery(slidesRoot, assets);
      initPresskitPhotoSlider();
    }

    if (dl) {
      const url = blocks.get('presskit_download_url');
      if (url) dl.setAttribute('href', String(url));
    }

    if (blockNodes.length) {
      renderTextBlocks(blockNodes, blocks);
    }
  } catch (e) {
    console.warn('[presskit] Supabase hydrate error:', e);
    showSupabaseBanners();
  }
}
