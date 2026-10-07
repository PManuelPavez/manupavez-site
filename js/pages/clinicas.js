import { supabase, hasSupabase } from "../data/supabaseClient.js";
import { sendLead } from "../data/leadMailer.js";

export function initClinicas() {
  const page = document.body.dataset.page;
  const isClinicas = page === "clinicas";
  const isAplicar = page === "aplicar";
  if (!isClinicas && !isAplicar) return;

  initForm();

  // La grilla de planes solo va en /clinicas — /aplicar no la necesita.
  if (isClinicas && hasSupabase()) {
    loadClinics();
  } else if (isClinicas) {
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
      // Origen del lead: página + campaña (para trackear IG vs directo)
      const params = new URLSearchParams(window.location.search);
      const page = document.body.dataset.page || "unknown";
      const utmSource = params.get("utm_source") || "direct";
      const utmMedium = params.get("utm_medium") || "";
      const utmCampaign = params.get("utm_campaign") || "";
      const origen = [`page:${page}`, `source:${utmSource}`, utmMedium && `medium:${utmMedium}`, utmCampaign && `campaign:${utmCampaign}`]
        .filter(Boolean).join(" · ");

      // Envío directo al mail (FormSubmit) — sin API keys ni backend
      await sendLead(
        {
          Nombre: data.name || "",
          Email: data.email || "",
          Nivel: data.level || "",
          Objetivo: data.goal || "",
          Mensaje: data.message || "",
          Origen: origen,
        },
        { subject: `Aplicación Frequency Lab — ${data.name || "sin nombre"} [${utmSource}]` }
      );

      // Mostrar éxito
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
        "No pude enviar automático. Te abro el mail con tus datos como plan B; si no, escribime a manupavez22@gmail.com."
      );
      submitBtn.disabled = false;
      submitBtn.removeAttribute("aria-busy");
      submitBtn.textContent = originalLabel;

      // Plan B: no perder el lead — abrimos el cliente de mail con los datos.
      window.location.href = buildLabMailto(data);
    }
  });

  setProgress(0);
}

// Fallback: arma un mailto con los datos de la aplicación al Lab.
function buildLabMailto(data = {}) {
  const subject = `Aplicación Frequency Lab — ${data.name || "sin nombre"}`;
  const body = [
    `Nombre: ${data.name || ""}`,
    `Email: ${data.email || ""}`,
    `Nivel: ${data.level || ""}`,
    `Objetivo: ${data.goal || ""}`,
    "",
    "Mensaje:",
    data.message || "",
  ].join("\n");
  return `mailto:manupavez22@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// =========================
// FORMATOS: mentorías del shop (tabla products)
// El precio sale del shop: si cambia en el panel, cambia acá también.
// =========================
const usd = (n) => `$${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })} USD`;

async function loadClinics() {
  const dynamicContainer = document.querySelector('[data-sb="clinics"]');

  try {
    const { data: products } = await supabase
      .from("products")
      .select("slug, name, description, kind, category, price_usd, unit")
      .eq("category", "mentorias")
      .order("sort");
    const mentorias = (products || []).filter((p) => p.price_usd);

    // Precio de la tarjeta principal (texto fijo en el HTML)
    document.querySelectorAll("[data-product-price]").forEach((el) => {
      const p = mentorias.find((x) => x.slug === el.dataset.productPrice);
      if (p) el.textContent = usd(p.price_usd);
    });

    // Las demás mentorías del shop (la Clásica ya está fija en el HTML)
    const extras = mentorias
      .filter((p) => !document.querySelector(`[data-product-price="${p.slug}"]`))
      .map((p) => ({
        titulo: p.name.replace(/^mentor[ií]a\s*1:1\s*[-–]\s*/i, ""),
        badge: "Mentoría 1:1",
        descripcion: p.description || "",
        lead: "",
        precio: usd(p.price_usd),
        periodo: p.unit === "mes" ? "/ mes" : `/ ${p.unit}`,
        features: [],
        cupos_totales: 0,
        cupos_activos: 0,
        status: "disponible",
        cta_texto: "Ver en el shop →",
        cta_link: "shop.html#mentorias",
      }));
    if (dynamicContainer) {
      dynamicContainer.innerHTML = extras.map(renderActiveCard).join("");
    }
  } catch (err) {
    console.error("[clinicas] Error cargando planes:", err);
  }
}

function renderActiveCard(p) {
  const featuresHtml = p.features.length
    ? `<div class="format-card__includes">
        <span class="format-card__includes-label">Incluye</span>
        <ul class="format-list">
          ${p.features.map(f => `<li>${escapeHtml(f)}</li>`).join("")}
        </ul>
      </div>`
    : "";

  const cuposDisponibles = p.cupos_totales - p.cupos_activos;
  const scarcityHtml = p.cupos_totales > 0
    ? `<p class="format-card__scarcity">
        Cupos activos: <strong>${cuposDisponibles} de ${p.cupos_totales}</strong> disponibles.<br>
        <span class="muted">Cuando se completan, se cierran.</span>
      </p>`
    : "";

  const priceHtml = p.precio
    ? `<div class="format-card__price">
        <span class="format-card__amount">${escapeHtml(p.precio)}</span>
        ${p.periodo ? `<span class="format-card__period">${escapeHtml(p.periodo)}</span>` : ""}
      </div>`
    : "";

  return `
    <article class="format-card">
      <span class="format-card__flag">Disponible ahora</span>
      <div class="format-card__body">
        <header class="format-card__head">
          ${p.badge ? `<span class="format-card__badge">${escapeHtml(p.badge)}</span>` : ""}
          <h3 class="format-card__title">${escapeHtml(p.titulo)}</h3>
        </header>
        ${p.lead ? `<p class="format-card__lead">${escapeHtml(p.lead)}</p>` : ""}
        ${p.descripcion ? `<p class="format-card__text">${escapeHtml(p.descripcion)}</p>` : ""}
        ${featuresHtml}
        <div class="format-card__footer">
          ${priceHtml}
          ${scarcityHtml}
          <a href="${escapeHtml(p.cta_link)}" class="mp-btn orange format-card__cta">
            ${escapeHtml(p.cta_texto)}
          </a>
        </div>
      </div>
    </article>`;
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
