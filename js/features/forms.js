import { sendLead } from "../data/leadMailer.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TYPE_LABELS = {
  club: "Club nocturno",
  festival: "Festival",
  "fiesta-privada": "Fiesta privada",
  "open-air": "Evento al aire libre",
  after: "After party",
  clinica: "Clínica / Mentoría",
  otro: "Otro",
};

export function initContactForm() {
  const form = document.getElementById("contact-form");
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const note = form.querySelector("#form-note");
  const submitBtn = form.querySelector('button[type="submit"]');
  const successPanel = document.querySelector("[data-booking-success]");

  // --- helpers de error por campo ---
  const fieldOf = (input) => input.closest(".form-field");
  const errorOf = (name) => form.querySelector(`[data-error-for="${name}"]`);

  function setFieldError(input, msg) {
    fieldOf(input)?.classList.add("has-error");
    const el = errorOf(input.name);
    if (el) el.textContent = msg;
  }

  function clearFieldError(input) {
    fieldOf(input)?.classList.remove("has-error");
    const el = errorOf(input.name);
    if (el) el.textContent = "";
  }

  function setNote(msg, isError = false) {
    if (!note) return;
    note.textContent = msg;
    note.classList.toggle("is-error", isError);
  }

  // Limpia el error de un campo apenas el usuario lo corrige
  form.addEventListener("input", (e) => {
    if (e.target.name) clearFieldError(e.target);
  });

  function validate({ name, email, type, message }, els) {
    let firstInvalid = null;
    const fail = (input, msg) => {
      setFieldError(input, msg);
      if (!firstInvalid) firstInvalid = input;
    };

    if (!name) fail(els.name, "Decime tu nombre.");
    if (!email) fail(els.email, "Necesito un mail para responderte.");
    else if (!EMAIL_RE.test(email)) fail(els.email, "Ese mail no parece válido.");
    if (!type) fail(els.type, "Elegí un tipo de evento.");
    if (!message) fail(els.message, "Contame un poco del evento.");

    return firstInvalid;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setNote("");

    const els = {
      name: form.elements["name"],
      email: form.elements["email"],
      type: form.elements["type"],
      message: form.elements["message"],
    };

    const data = {
      name: (els.name?.value || "").trim(),
      email: (els.email?.value || "").trim(),
      type: (els.type?.value || "").trim(),
      message: (els.message?.value || "").trim(),
    };

    const firstInvalid = validate(data, els);
    if (firstInvalid) {
      firstInvalid.focus();
      setNote("Revisá los campos marcados.", true);
      return;
    }

    // Estado de carga
    const originalLabel = submitBtn.textContent;
    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.disabled = true;
    setNote("Enviando…");

    // Envío directo al mail (FormSubmit) — sin API keys
    try {
      await sendLead(
        {
          Nombre: data.name,
          Email: data.email,
          "Tipo de evento": TYPE_LABELS[data.type] || data.type,
          Mensaje: data.message,
        },
        { subject: `Booking / Contacto — ${data.name}` }
      );
      showSuccess();
      return;
    } catch (err) {
      console.warn("[booking] envío falló, fallback a mailto:", err);
    }

    // Plan B: abrir el cliente de mail
    restoreButton(submitBtn, originalLabel);
    setNote("No pude enviar automático. Te abro el mail como plan B.", true);
    window.location.href = buildMailto(data);
  });

  function showSuccess() {
    if (successPanel) {
      form.hidden = true;
      successPanel.hidden = false;
      successPanel.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setNote("¡Enviado! Te respondo a la brevedad.");
      form.reset();
    }
  }

  function restoreButton(btn, label) {
    btn.removeAttribute("aria-busy");
    btn.disabled = false;
    btn.textContent = label;
  }
}

function buildMailto({ name, email, type, message }) {
  const subject = "Booking / Contacto - Manu Pavez";
  const body = [
    `Nombre: ${name}`,
    `Email: ${email}`,
    `Tipo de evento: ${TYPE_LABELS[type] || type}`,
    "",
    "Mensaje:",
    message,
  ].join("\n");
  return `mailto:manupavez22@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
