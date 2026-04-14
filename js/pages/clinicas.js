import { hasSupabase, supabase } from "../data/supabaseClient.js";
import { getClinics } from "../data/content.js";

export function initClinicas() {
  const isPage = document.body.dataset.page === "clinicas";
  if (!isPage) return;

  if (!hasSupabase()) {
    console.warn("[clinicas] Supabase no configurado");
    return;
  }

  initForm();
  loadClinics();
}


// =========================
// FORM (multi-step)
// =========================

function initForm() {
  const form = document.querySelector('[data-clinic-form]');
  if (!form) return;

  const steps = form.querySelectorAll('.form-step');
  const stepNumber = document.getElementById('step-number');
  const submitBtn = form.querySelector('[type="submit"]');

  let current = 0;

  function validateStep(step) {
    const required = step.querySelectorAll('[required]');
    for (let input of required) {
      if (!input.value.trim()) {
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

  // NEXT
  form.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!validateStep(steps[current])) return;
      current++;
      showStep(current);
    });
  });

  // PREV
  form.querySelectorAll('[data-prev]').forEach(btn => {
    btn.addEventListener('click', () => {
      current--;
      showStep(current);
    });
  });

  // SUBMIT
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form));

    try {
      // UX loading
      submitBtn.disabled = true;
      submitBtn.textContent = "Enviando...";

      // ===== DB =====
      await supabase.from('lab_leads').insert([data]);

      // ===== EMAIL =====
      await fetch('https://psnprhzowknhfylvgcci.supabase.co/functions/v1/send-lead-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      // ===== SUCCESS UX =====
      form.innerHTML = `
        <div class="form-success">
          <h3>Listo 🚀</h3>
          <p>Recibí tu aplicación. Te escribo en breve.</p>
        </div>
     `;

    } catch (err) {
      console.error("ERROR SUBMIT:", err);
      alert("Error al enviar 😢");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "QUIERO ENTRAR AL LAB";
    }
  });
}


// =========================
// LOAD CLINICS (desde content.js)
// =========================

async function loadClinics() {
  const container = document.querySelector('[data-sb="clinics"]');
  if (!container) return;

  try {
    const data = await getClinics();

    if (!data || data.length === 0) {
      container.innerHTML = `<p>No hay clínicas disponibles.</p>`;
      return;
    }

    container.innerHTML = data.map(item => `
      <article class="clinic-card">
        <h3 class="clinic-title">${item.title}</h3>
        <p class="clinic-subtitle">${item.subtitle || ''}</p>
      </article>
    `).join('');

  } catch (err) {
    console.error("Error cargando clinics:", err);
  }
}