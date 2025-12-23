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

// Site-wide features
safeInit("nav", initNav);
safeInit("reveal", initReveal);
safeInit("activeNav", initActiveNav);
safeInit("scrollTop", initScrollTop);
safeInit("sliders", initSliders);
safeInit("contactForm", initContactForm);

// Page modules (auto-detect via body[data-page])
safeInit("home", initHome);
safeInit("presskit", initPresskit);
safeInit("clinicas", initClinicas);
safeInit("bio", initBio);
// =========================
// Presskit slider (sin tocar HTML)
// =========================
function initPresskitSlider() {
  const isPresskit = document.body?.dataset?.page === "presskit";
  if (!isPresskit) return;

  const slider = document.querySelector('section.slider[data-slider="presskit"]');
  if (!slider) return;

  const slidesWrap = slider.querySelector(".slides");
  const imgs = Array.from(slidesWrap?.querySelectorAll("img") || []);
  const dotsWrap = slider.querySelector(".slider-dots");

  if (!slidesWrap || !dotsWrap || imgs.length < 2) return;

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  const autoplayMs = Number(slider.getAttribute("data-autoplay")) || 0;

  let index = Math.max(0, imgs.findIndex((i) => i.classList.contains("active")));
  if (index < 0) index = 0;

  // Build dots
  dotsWrap.innerHTML = "";
  const dots = imgs.map((_, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "dot" + (i === index ? " is-active" : "");
    b.setAttribute("aria-label", `Foto ${i + 1} de ${imgs.length}`);
    b.addEventListener("click", () => goTo(i, true));
    dotsWrap.appendChild(b);
    return b;
  });

  function paint() {
    imgs.forEach((img, i) => img.classList.toggle("active", i === index));
    dots.forEach((d, i) => d.classList.toggle("is-active", i === index));
  }

  function goTo(i, user = false) {
    index = (i + imgs.length) % imgs.length;
    paint();
    if (user) restartAutoplay(); // interacción humana = reiniciar timer
  }

  // Keyboard
  slider.tabIndex = -1; // foco programático si querés, no molesta
  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); goTo(index + 1, true); }
    if (e.key === "ArrowLeft")  { e.preventDefault(); goTo(index - 1, true); }
  });

  // Swipe (mínimo viable, sin librerías)
  let x0 = null;
  slidesWrap.addEventListener("pointerdown", (e) => {
    x0 = e.clientX;
  });
  slidesWrap.addEventListener("pointerup", (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) < 40) return;
    goTo(dx < 0 ? index + 1 : index - 1, true);
  });

  // Autoplay (solo si no reduced motion)
  let t = null;
  function stopAutoplay() {
    if (t) { clearInterval(t); t = null; }
  }
  function startAutoplay() {
    stopAutoplay();
    if (reduced) return;
    if (!autoplayMs || autoplayMs < 1200) return;
    t = setInterval(() => goTo(index + 1, false), autoplayMs);
  }
  function restartAutoplay() {
    stopAutoplay();
    startAutoplay();
  }

  // Pausa cuando no está visible o no hay foco
  const io = new IntersectionObserver((entries) => {
    const visible = entries.some((en) => en.isIntersecting);
    if (visible) startAutoplay();
    else stopAutoplay();
  }, { threshold: 0.35 });

  io.observe(slider);

  slider.addEventListener("mouseenter", stopAutoplay);
  slider.addEventListener("mouseleave", startAutoplay);
  slider.addEventListener("focusin", stopAutoplay);
  slider.addEventListener("focusout", startAutoplay);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoplay();
    else startAutoplay();
  });

  paint();
  startAutoplay();
}

initPresskitSlider();
