// auth.js — ÁREA DE ALUMNOS de /clinicas: login por email (magic link, respaldo del PIN).
// El espacio del alumno vive aparte, en /alumnos.html (sin el resto del sitio):
// acá solo se inicia sesión y se deriva.
import { supabase, hasSupabase } from "../data/supabaseClient.js";
import { mountTurnstile, turnstileSiteKey } from "./turnstile.js";

// ¿Esta carga es la vuelta de un magic link? (tokens en el hash o ?code=)
const cameFromMagicLink =
  /access_token|type=magiclink|type=signup/.test(location.hash) ||
  new URLSearchParams(location.search).has("code");

export function initStudentAuth() {
  if (document.body.dataset.page !== "clinicas") return;

  const root = document.querySelector("[data-auth]");
  if (!root) return;

  if (!hasSupabase() || !supabase) {
    console.warn("[auth] Supabase no configurado — área de alumnos deshabilitada");
    return;
  }

  const form = root.querySelector("[data-auth-form]");
  const emailInput = root.querySelector("[data-auth-email]");
  const note = root.querySelector("[data-auth-note]");
  const loggedOut = root.querySelector("[data-auth-loggedout]");
  const loggedIn = root.querySelector("[data-auth-loggedin]");
  const userLabel = root.querySelector("[data-auth-user]");
  const logoutBtn = root.querySelector("[data-auth-logout]");
  const contentArea = root.querySelector("[data-alumnos-content]");

  function render(session) {
    const isIn = Boolean(session);
    if (isIn && cameFromMagicLink) {
      location.replace("alumnos.html");
      return;
    }
    if (loggedOut) loggedOut.hidden = isIn;
    if (loggedIn) loggedIn.hidden = !isIn;
    if (isIn && userLabel) userLabel.textContent = session.user?.email || "";
    if (contentArea) {
      contentArea.innerHTML = isIn
        ? `<a class="mp-btn primary" href="alumnos.html">IR A MI ESPACIO →</a>`
        : `<p class="muted">Pronto vas a ver acá el material del Lab, recursos y seguimiento.</p>`;
    }
  }

  supabase.auth.getSession().then(({ data }) => render(data.session));
  supabase.auth.onAuthStateChange((_event, session) => render(session));

  // Turnstile en el magic link: solo si está configurado (y Supabase Auth lo exige)
  let captcha = { getToken: async () => "", reset() {} };
  if (form && turnstileSiteKey()) {
    const slot = document.createElement("div");
    slot.className = "auth-turnstile";
    form.after(slot);
    mountTurnstile(slot).then((c) => { captcha = c; });
  }

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (emailInput?.value || "").trim();
    if (!email || !emailInput.checkValidity()) {
      if (note) note.textContent = "Escribí un email válido.";
      return;
    }

    if (note) note.textContent = "Enviando link de acceso…";
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn?.setAttribute("aria-busy", "true");

    const captchaToken = await captcha.getToken();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // Vuelve a /clinicas (URL ya habilitada en Supabase) y de ahí deriva a /alumnos
      options: { emailRedirectTo: `${location.origin}/clinicas.html`, ...(captchaToken ? { captchaToken } : {}) },
    });
    captcha.reset();

    submitBtn?.removeAttribute("aria-busy");

    // Mismo mensaje exista o no el alumno: no revelamos qué emails tienen acceso.
    // Solo el límite de envíos (429) se informa distinto.
    const rateLimited = error?.status === 429;
    if (note) {
      note.textContent = rateLimited
        ? "Pediste varios links seguidos. Esperá un minuto y probá de nuevo."
        : "Si tu email está habilitado en el Lab, te llega un link en unos segundos. Abrilo desde este mismo dispositivo. Si no te llega, escribime.";
      note.classList.toggle("is-error", rateLimited);
    }
    if (!rateLimited) form.reset();
  });

  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
}
