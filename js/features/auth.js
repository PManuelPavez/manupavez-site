import { supabase, hasSupabase } from "../data/supabaseClient.js";

// Área de alumnos (Frequency Lab) — login con magic link (OTP por email).
// 100% client-side, compatible con hosting estático (GitHub Pages).
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

  function render(session) {
    const isIn = Boolean(session);
    if (loggedOut) loggedOut.hidden = isIn;
    if (loggedIn) loggedIn.hidden = !isIn;
    if (isIn && userLabel) userLabel.textContent = session.user?.email || "";
  }

  // Estado inicial + reactividad (cubre el callback del magic link al volver)
  supabase.auth.getSession().then(({ data }) => render(data.session));
  supabase.auth.onAuthStateChange((_event, session) => render(session));

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = (emailInput?.value || "").trim();
    if (!email) {
      if (note) note.textContent = "Escribí tu email.";
      return;
    }

    if (note) note.textContent = "Enviando link de acceso…";
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn?.setAttribute("aria-busy", "true");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split("#")[0] },
    });

    submitBtn?.removeAttribute("aria-busy");

    if (note) {
      note.textContent = error
        ? "No pude enviar el link. Probá de nuevo en unos segundos."
        : "Listo ✓ Te mandé un link a tu mail. Abrilo desde este mismo dispositivo para entrar.";
      note.classList.toggle("is-error", Boolean(error));
    }
    if (!error) form.reset();
  });

  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
}
