export function initClinicas() {
  const isPage = document.body.dataset.page === "clinicas";
  if (!isPage) return;

  // 👉 seguridad: no romper si supabase no está listo
  if (typeof window.supabase === "undefined") {
    console.warn("Supabase no disponible");
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

  // next
  form.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!validateStep(steps[current])) return;
      current++;
      showStep(current);
    });
  });

  // prev
  form.querySelectorAll('[data-prev]').forEach(btn => {
    btn.addEventListener('click', () => {
      current--;
      showStep(current);
    });
  });

  // submit
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form));

    try {
      // ===== GUARDAR EN DB =====
      if (window.supabase) {
        await window.supabase.from('lab_leads').insert([data]);
      }

      // ===== ENVIAR EMAIL =====
      await fetch('https://psnprhzowknhfylvgcci.supabase.co/functions/v1/send-lead-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnByaHpvd2tuaGZ5bHZnY2NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTM5MDQsImV4cCI6MjA4MTcyOTkwNH0.FFGPhYc_8J-U5BSvx0VGnpzmaGLoP-NX-6MRe0RMR0U'
        },
        body: JSON.stringify(data)
      });

      // ===== UX SUCCESS =====
      form.innerHTML = `
        <div class="form-success">
          <h3>Listo 🚀</h3>
          <p>Recibí tu aplicación. Te escribo en breve.</p>
        </div>
      `;

    } catch (err) {
      console.error("ERROR SUBMIT:", err);
      alert("Error al enviar 😢");
    }
  });
}


// =========================
// LOAD CLINICS (Supabase)
// =========================

async function loadClinics() {
  const container = document.querySelector('[data-sb="clinics"]');
  if (!container) return;

  if (typeof window.supabase === "undefined") return;

  try {
    const { data, error } = await window.supabase
      .from('clinics')
      .select('*')
      .eq('active', true);

    if (error) {
      console.warn("Clinics error:", error);
      return;
    }

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