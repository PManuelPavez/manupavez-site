import { hasSupabase, supabase } from "../data/supabaseClient.js";
import { getClinics } from "../data/content.js";

export function initClinicas() {
  const isPage = document.body.dataset.page === "clinicas";
  if (!isPage) return;

  initForm();

  if (hasSupabase()) {
    loadClinics();
  } else {
    console.warn("[clinicas] Supabase no configurado — listado de clínicas no disponible");
  }
}

// =========================
// FORM (multi-step)
// =========================
function initForm() {
  const form = document.querySelector("[data-clinic-form]");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const steps = Array.from(form.querySelectorAll(".form-step"));
  const stepNumberEl = document.getElementById("step-number");
  const progressBar = document.querySelector(".form-progress-bar");
  const successPanel = document.querySelector("[data-form-success]");
  const errorEl = form.querySelector("[data-form-error]");

  const total = steps.length;
  let current = 0;

  function setProgress(idx) {
    if (stepNumberEl) stepNumberEl.textContent = String(idx + 1);
    if (progressBar) {
      const pct = Math.round(((idx + 1) / total) * 100);
      progressBar.style.setProperty("--progress", `${pct}%`);
    }
  }

  function showStep(idx) {
    current = Math.max(0, Math.min(total - 1, idx));
    steps.forEach((step, i) => step.classList.toggle("is-active", i === current));
    setProgress(current);

    const firstInput = steps[current].querySelector("input, select, textarea");
    if (firstInput && firstInput.type !== "radio") {
      // Pequeño delay para que se vea la transición del paso
      setTimeout(() => firstInput.focus({ preventScroll: false }), 200);
    }
  }

  function validateStep(step) {
    const required = step.querySelectorAll("[required]");
    for (const input of required) {
      if (input.type === "radio") {
        const group = step.querySelectorAll(`[name="${input.name}"]`);
        const checked = Array.from(group).some((r) => r.checked);
        if (!checked) {
          group[0]?.focus();
          return false;
        }
      } else if (!input.value.trim()) {
        input.focus();
        return false;
      } else if (input.type === "email" && !input.checkValidity()) {
        input.focus();
        return false;
      }
    }
    return true;
  }

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function hideError() {
    if (!errorEl) return;
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  // NEXT
  form.querySelectorAll("[data-next]").forEach((btn) => {
    btn.addEventListener("click", () => {
      hideError();
      if (!validateStep(steps[current])) return;
      showStep(current + 1);
    });
  });

  // PREV
  form.querySelectorAll("[data-prev]").forEach((btn) => {
    btn.addEventListener("click", () => {
      hideError();
      showStep(current - 1);
    });
  });

  // ENTER en cualquier input que no sea textarea = avanzar
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.target.tagName === "TEXTAREA") return;
    const isLastStep = current === total - 1;
    if (isLastStep) return; // dejá que submit haga lo suyo
    e.preventDefault();
    if (validateStep(steps[current])) showStep(current + 1);
  });

  // SUBMIT
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();

    if (!validateStep(steps[current])) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    const data = Object.fromEntries(new FormData(form));

    submitBtn.disabled = true;
    submitBtn.setAttribute("aria-busy", "true");
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = "Enviando";

    try {
      if (!hasSupabase()) {
        throw new Error("supabase-not-configured");
      }

      // 1) Guardar lead en DB
      const { error: dbError } = await supabase.from("lab_leads").insert([data]);
      if (dbError) throw dbError;

      // 2) Disparar notificación por mail vía edge function
      // (usa el JWT anon del cliente — el bearer hardcodeado quedó eliminado)
      const { error: fnError } = await supabase.functions.invoke("send-lead-email", {
        body: data,
      });
      if (fnError) {
        // El lead ya quedó en DB; logueamos pero no rompemos el flujo del usuario
        console.warn("[lab_leads] notificación falló pero el lead se guardó:", fnError);
      }

      // 3) Mostrar éxito
      form.hidden = true;
      const progressWrap = document.querySelector(".form-progress");
      const introEl = document.querySelector(".form-intro");
      if (progressWrap) progressWrap.hidden = true;
      if (introEl) introEl.hidden = true;
      if (successPanel) {
        successPanel.hidden = false;
        successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch (err) {
      console.error("[lab_leads] submit error:", err);
      showError(
        "No pude enviar tu aplicación. Probá de nuevo en unos segundos o escribime directo a manupavez22@gmail.com."
      );
      submitBtn.disabled = false;
      submitBtn.removeAttribute("aria-busy");
      submitBtn.textContent = originalLabel;
    }
  });

  setProgress(0);
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
      container.innerHTML = `<p class="muted">Pronto hay nuevas fechas.</p>`;
      return;
    }

    container.innerHTML = data
      .map(
        (item) => `
      <article class="clinic-card">
        <h3 class="clinic-title">${escapeHtml(item.title)}</h3>
        <p class="clinic-subtitle">${escapeHtml(item.subtitle || "")}</p>
      </article>`
      )
      .join("");
  } catch (err) {
    console.error("Error cargando clinics:", err);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}
