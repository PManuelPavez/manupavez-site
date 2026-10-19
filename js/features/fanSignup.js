// Lista de fans: "Avisame de nuevas fechas". Alta con consentimiento vía Edge Function fans-subscribe.
import { lang } from "../core/i18n.js";
import { track } from "../core/analytics.js";

const TXT = {
  es: { invalid: "Revisá el mail.", sending: "Anotando…", ok: "¡Listo! Te aviso cuando haya fecha.", error: "No se pudo anotar. Probá de nuevo." },
  en: { invalid: "Please check your email.", sending: "Saving…", ok: "Done! I'll let you know about new dates.", error: "Couldn't save it. Please try again." },
}[lang];

export function initFanSignup() {
  document.querySelectorAll("[data-fan-signup]").forEach((form) => {
    if (form.dataset.bound === "1") return;
    form.dataset.bound = "1";
    const note = form.querySelector("[data-fan-note]");
    const btn = form.querySelector('button[type="submit"]');

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = form.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        note.textContent = TXT.invalid;
        form.email.focus();
        return;
      }
      const url = window.MP_SUPABASE?.url;
      if (!url) { note.textContent = TXT.error; return; }
      btn.disabled = true;
      note.textContent = TXT.sending;
      try {
        const res = await fetch(`${url}/functions/v1/fans-subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, city: form.city.value.trim(), website: form.website.value }),
        });
        if (!res.ok) throw new Error(String(res.status));
        form.reset();
        note.textContent = TXT.ok;
        form.classList.add("is-done");
        track("fans-alta");
      } catch {
        note.textContent = TXT.error;
      } finally {
        btn.disabled = false;
      }
    });
  });
}
