import { $ } from "../core/dom.js";
import { hasSupabase, waitForSupabase } from "../data/supabaseClient.js";
import { getClinics } from "../data/content.js";
import { renderClinics } from "../ui/renderers.js";
import { initReveal } from "../features/reveal.js";

export function initClinicas() {
  const root = $("[data-sb='clinics']");
  if (!root) return;

  if (!hasSupabase()) {
    waitForSupabase().then((sb) => {
      if (!sb) return;
      hydrate(root);
    });
    return;
  }

  hydrate(root);
}

async function hydrate(root) {
  try {
    const items = await getClinics();
    renderClinics(root, items || []);
    initReveal();
  } catch (e) {
    console.warn("[clinicas] Supabase hydrate error:", e);
  }
}
