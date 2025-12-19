import { $$ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getPageBlocks } from "../data/content.js";
import { renderTextBlocks } from "../ui/renderers.js";
import { initReveal } from "../features/reveal.js";
import { pageName, showSupabaseBanners } from "./_common.js";

export function initBio() {
  if (pageName() !== "bio") return;

  if (!hasSupabase()) {
    showSupabaseBanners();
    return;
  }

  hydrate();
}

async function hydrate() {
  try {
    const nodes = $$('[data-sb-block]');
    if (!nodes.length) return;

    const keys = nodes.map((n) => n.getAttribute('data-sb-block')).filter(Boolean);
    const blocks = await getPageBlocks(keys);

    renderTextBlocks(nodes, blocks);
    initReveal();
  } catch (e) {
    console.warn('[bio] Supabase hydrate error:', e);
    showSupabaseBanners();
  }
}
