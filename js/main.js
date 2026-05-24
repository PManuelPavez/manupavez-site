import { initNav } from "./features/nav.js";
import { initReveal } from "./features/reveal.js";
import { initActiveNav } from "./features/activeNav.js";
import { initScrollTop } from "./features/scrollTop.js";
import { initSliders } from "./features/slider.js";
import { initContactForm } from "./features/forms.js";
import { initHome } from "./pages/home.js";
import { initPresskit } from "./pages/presskit.js";
import { initClinicas } from "./pages/clinicas.js";
import { initBio } from "./pages/bio.js";

function safeInit(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[init:${name}]`, e);
  }
}

// Site-wide features (no dependen de Supabase)
safeInit("nav", initNav);
safeInit("reveal", initReveal);
safeInit("activeNav", initActiveNav);
safeInit("scrollTop", initScrollTop);
safeInit("sliders", initSliders);
safeInit("contactForm", initContactForm);

// Inits que dependen de Supabase: esperar a que la config esté cargada (timeout: 5s)
function waitForSupabase(callback, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const start = Date.now();
  const tick = () => {
    if (window.MP_SUPABASE?.url && window.MP_SUPABASE?.anonKey) {
      callback();
      return;
    }
    if (Date.now() - start > timeoutMs) {
      console.warn("[init] Supabase config no se cargó en", timeoutMs, "ms — continuando sin él");
      callback();
      return;
    }
    setTimeout(tick, intervalMs);
  };
  tick();
}

waitForSupabase(() => {
  safeInit("home", initHome);
  safeInit("presskit", initPresskit);
  safeInit("clinicas", initClinicas);
  safeInit("bio", initBio);
});
