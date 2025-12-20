import { $$ } from "../core/dom.js";
import { hasSupabase, waitForSupabase } from "../data/supabaseClient.js";
import { getBlocks } from "../data/content.js";
import { renderTextBlocks } from "../ui/renderers.js";
import { initReveal } from "../features/reveal.js";

export function initBio() {
  const nodes = $$('[data-sb-block]');
  if (!nodes.length) return;

  if (!hasSupabase()) {
    waitForSupabase().then((sb) => {
      if (!sb) return;
      hydrate(nodes);
    });
    return;
  }

  hydrate(nodes);
}

async function hydrate(nodes) {
  try {
    const keys = nodes.map((n) => n.getAttribute('data-sb-block')).filter(Boolean);
    const blocks = await getBlocks(keys);

    renderTextBlocks(nodes, blocks);
    initReveal();
  } catch (e) {
    console.warn('[bio] Supabase hydrate error:', e);
  }
}
