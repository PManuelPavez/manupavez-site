import { $ } from "../core/dom.js";
import { hasSupabase } from "../data/supabaseClient.js";
import { getClinics } from "../data/content.js";
import { renderClinics } from "../ui/renderers.js";
import { initReveal } from "../features/reveal.js";

export function initClinicas() {
  const root = $("[data-sb='clinics']");
  if (!root) return;

  if (!hasSupabase()) return;
  hydrate(root);
}

async function hydrate(root) {
  try {
    const items = await getClinics();
    renderClinics(root, items);
    initReveal();
  } catch (e) {
    console.warn("[clinicas] Supabase hydrate error:", e);
  }
}
initPresskitSlider();
const hero = document.querySelector('.lab-hero');

window.addEventListener('scroll', () => {
  const scrollY = window.scrollY;

  if (!hero) return;

  const fade = Math.max(1 - scrollY / 400, 0);
  const scale = 1 - scrollY / 2000;

  hero.style.opacity = fade;
  hero.style.transform = `scale(${scale})`;
});
const revealEl = document.querySelector('.reveal-enter');

window.addEventListener('scroll', () => {
  if (!revealEl) return;

  const rect = revealEl.getBoundingClientRect();

  if (rect.top < window.innerHeight * 0.8) {
    revealEl.classList.add('is-visible');
  }
});
const indicator = document.querySelector('.lab-scroll-indicator');

window.addEventListener('scroll', () => {
  if (!indicator) return;

  if (window.scrollY > 40) {
    indicator.style.opacity = "0";
  } else {
    indicator.style.opacity = "0.6";
  }
});
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