export function initClinicas() {
  const isPage = document.body.dataset.page === "clinicas";
  if (!isPage) return;

  if (typeof supabase === "undefined") {
    console.warn("Supabase no disponible");
    return;
  }

  initForm();
  loadClinics();
}


// =========================
// FORM
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

  form.querySelectorAll('[data-next]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!validateStep(steps[current])) return;
      current++;
      showStep(current);
    });
  });

  form.querySelectorAll('[data-prev]').forEach(btn => {
    btn.addEventListener('click', () => {
      current--;
      showStep(current);
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const data = Object.fromEntries(new FormData(form));

    try {
      await supabase.from('lab_leads').insert([data]);

      await fetch('https://psnprhzowknhfylvgcci.supabase.co/functions/v1/send-lead-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer TU_ANON_KEY'
        },
        body: JSON.stringify(data)
      });

      form.innerHTML = `
        <div class="form-success">
          <h3>Listo 🚀</h3>
          <p>Recibí tu aplicación. Te escribo en breve.</p>
        </div>
      `;

    } catch (err) {
      console.error(err);
    }
  });
}


// =========================
// LOAD CLINICS
// =========================

async function loadClinics() {
  const container = document.querySelector('[data-sb="clinics"]');
  if (!container) return;

  try {
    const { data } = await supabase
      .from('clinics')
      .select('*')
      .eq('active', true);

    if (!data) return;

    container.innerHTML = data.map(item => `
      <article class="clinic-card">
        <h3>${item.title}</h3>
        <p>${item.subtitle}</p>
      </article>
    `).join('');

  } catch (err) {
    console.error("Error cargando clinics", err);
  }
}