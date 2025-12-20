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

// Flag: si alguien todavía carga js/app.js legacy, puede auto-desactivarse.
window.__MP_ESM__ = true;

function ready(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

function safeInit(name, fn) {
  try {
    fn();
  } catch (e) {
    console.error(`[init:${name}]`, e);
  }
}

ready(() => {
  // Site-wide
  safeInit("nav", initNav);
  safeInit("reveal", initReveal);
  safeInit("activeNav", initActiveNav);
  safeInit("scrollTop", initScrollTop);
  safeInit("sliders", initSliders);
  safeInit("contactForm", initContactForm);

  // Pages (DOM-driven dentro de cada init)
  safeInit("home", initHome);
  safeInit("presskit", initPresskit);
  safeInit("clinicas", initClinicas);
  safeInit("bio", initBio);
});
