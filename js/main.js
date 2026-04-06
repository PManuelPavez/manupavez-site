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

const form = document.querySelector('[data-clinic-form]');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const formData = new FormData(form);

    const data = {
      name: formData.get('name'),
      email: formData.get('email'),
      level: formData.get('level'),
      goal: formData.get('goal'),
      message: formData.get('message')
    };

    try {
      // 1. Guardar en Supabase
      await supabase.from('lab_leads').insert([data]);

      // 2. Enviar email
      await fetch('https://psnprhzowknhfylvgcci.supabase.co/functions/v1/send-lead-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnByaHpvd2tuaGZ5bHZnY2NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTM5MDQsImV4cCI6MjA4MTcyOTkwNH0.FFGPhYc_8J-U5BSvx0VGnpzmaGLoP-NX-6MRe0RMR0U'
        },
        body: JSON.stringify(data)
      });

      alert('Aplicación enviada 🚀');
      form.reset();

    } catch (err) {
      console.error(err);
      alert('Error al enviar 😢');
    }
  });
}
const steps = document.querySelectorAll('.form-step');
const stepNumber = document.getElementById('step-number');

let current = 0;

function validateStep(step) {
  const inputs = step.querySelectorAll('input, select, textarea');
  for (let input of inputs) {
    if (input.hasAttribute('required') && !input.value.trim()) {
      input.focus();
      return false;
    }
  }
  return true;
}

function showStep(index) {
  steps.forEach((step, i) => {
    step.classList.toggle('is-active', i === index);
  });

  if (stepNumber) {
    stepNumber.textContent = index + 1;
  }
}

document.querySelectorAll('[data-next]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!validateStep(steps[current])) return;
    current++;
    showStep(current);
  });
});

document.querySelectorAll('[data-prev]').forEach(btn => {
  btn.addEventListener('click', () => {
    current--;
    showStep(current);
  });
});