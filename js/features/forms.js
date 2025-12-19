import { hasSupabase } from "../data/supabaseClient.js";
import { insertBookingLead } from "../data/content.js";

export function initContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;

  if (form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  const note = form.querySelector("#form-note") || (() => {
    const p = document.createElement("p");
    p.id = "form-note";
    p.className = "form-note";
    p.setAttribute("role", "status");
    p.setAttribute("aria-live", "polite");
    form.appendChild(p);
    return p;
  })();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = (form.elements["name"]?.value || "").trim();
    const email = (form.elements["email"]?.value || "").trim();
    const type = (form.elements["type"]?.value || "").trim();
    const message = (form.elements["message"]?.value || "").trim();

    if (!name || !email || !type || !message) {
      note.textContent = "Te falta completar algún campo marcado con *.";
      return;
    }

    note.textContent = "Enviando…";

    // Plan A: Supabase
    if (hasSupabase()) {
      try {
        await insertBookingLead({ name, email, type, message });
        note.textContent = "Enviado. Te respondo a la brevedad.";
        form.reset();
        return;
      } catch (err) {
        console.warn("[booking_leads] error:", err);
        // fallback a mailto
      }
    }

    // Plan B: mailto
    note.textContent = "No pude enviar automático. Abro tu mail como plan B.";
    const subject = "Booking / Contacto - Manu Pavez";
    const body = [
      `Nombre: ${name}`,
      `Email: ${email}`,
      `Tipo de evento: ${type}`,
      "",
      "Mensaje:",
      message,
    ].join("\n");

    window.location.href = `mailto:manupavez22@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });
}
