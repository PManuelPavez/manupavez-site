import { $ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getClinics } from "../data/content.js";
import { renderClinics } from "../ui/renderers.js";
import { initReveal } from "../features/reveal.js";
import { pageName, showSupabaseBanners } from "./_common.js";

export function initClinicas() {
  if (pageName() !== "clinicas") return;

  if (!hasSupabase()) {
    showSupabaseBanners();
    return;
  }

  hydrate();
}

async function hydrate() {
  try {
    const root = $("[data-sb='clinics']");
    if (!root) return;

    const items = await getClinics();
    renderClinics(root, items);
    initReveal();
  } catch (e) {
    console.warn("[clinicas] Supabase hydrate error:", e);
    showSupabaseBanners();
  }
}
