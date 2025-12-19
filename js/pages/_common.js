import { $$ } from "../core/dom.js";

export function pageName() {
  return document.body?.dataset?.page || "";
}

export function showSupabaseBanners() {
  const banners = $$('[data-supabase-banner]');
  banners.forEach((b) => (b.hidden = false));
}
