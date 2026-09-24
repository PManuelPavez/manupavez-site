// alumnos.js — /alumnos.html: el espacio del alumno, aparte del resto del sitio.
// Sin sesión → login con PIN (+ Turnstile). Con sesión → su página del Lab.
import { supabase, hasSupabase } from "../data/supabaseClient.js";
import { mountPortal } from "../features/portal.js";
import { loginWithPin } from "../features/pinLogin.js";
import { mountTurnstile } from "../features/turnstile.js";

const $ = (sel) => document.querySelector(sel);
const status = $("[data-status]");
const loginEl = $("[data-login]");
const portalEl = $("[data-portal]");
const logoutBtn = $("[data-logout]");

// ?ver=<id> → vista previa de un alumno (la base solo la permite a un admin)
const previewId = (() => {
  const v = new URLSearchParams(location.search).get("ver") || "";
  return /^[0-9a-f-]{36}$/i.test(v) ? v : null;
})();

async function showPortal() {
  status.hidden = true;
  loginEl.hidden = true;
  portalEl.hidden = false;
  logoutBtn.hidden = false;
  const info = await mountPortal(portalEl, { previewStudentId: previewId });
  if (info?.name) document.title = `${info.name} — Frequency Lab`;
}

async function showLogin() {
  status.hidden = true;
  portalEl.hidden = true;
  logoutBtn.hidden = true;
  loginEl.hidden = false;

  const form = $("[data-pin-form]");
  const input = $("#pin");
  const note = $("[data-note]");
  const submitBtn = $("[data-submit]");
  const captcha = await mountTurnstile($("[data-captcha]"));
  let busy = false;

  const say = (text, isError = true) => {
    note.textContent = text || "";
    note.classList.toggle("is-error", Boolean(text) && isError);
  };

  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, 6);
    if (digits !== input.value) input.value = digits;
    if (note.classList.contains("is-error")) say("");
    if (digits.length === 6) form.requestSubmit();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    submitBtn.disabled = true;
    say("Verificando…", false);

    const result = await loginWithPin(input.value.trim(), await captcha.getToken());
    captcha.reset();
    busy = false;
    submitBtn.disabled = false;

    if (!result.ok) {
      input.value = "";
      input.focus();
      say(result.message);
      return;
    }
    if (result.redirect === "admin.html") {
      location.href = "admin.html";
      return;
    }
    const { data } = await supabase.auth.getSession();
    if (data.session) showPortal();
  });

  // El email se pide en /clinicas: que no se abra el popup de entrada al llegar
  $("[data-email-link]").addEventListener("click", () => {
    try { sessionStorage.setItem("mp-gate-dismissed", "1"); } catch { /* storage bloqueado */ }
  });

  setTimeout(() => input.focus(), 50);
}

logoutBtn.addEventListener("click", async () => {
  logoutBtn.disabled = true;
  await supabase.auth.signOut();
  location.replace("alumnos.html");
});

async function boot() {
  if (!hasSupabase() || !supabase) {
    status.textContent = "El acceso no está disponible en este momento.";
    return;
  }
  const { data } = await supabase.auth.getSession();
  if (data.session) showPortal();
  else showLogin();

  // Si la sesión se cierra en otra pestaña, esta vuelve al login
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.replace("alumnos.html");
  });
}

boot().catch((err) => {
  console.error("[alumnos]", err);
  status.textContent = "No se pudo cargar. Probá recargando la página.";
});
