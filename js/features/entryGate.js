// entryGate.js — Popup de entrada de /clinicas: "QUIERO EMPEZAR" o "YA SOY ALUMNO" (PIN).
// Se arma desde JS: clinicas.html no cambia. La seguridad del PIN vive en el
// servidor (Edge Function pin-login + límite de intentos en la base).
import { supabase, hasSupabase } from "../data/supabaseClient.js";
import { loginWithPin } from "./pinLogin.js";
import { mountTurnstile } from "./turnstile.js";

const DISMISS_KEY = "mp-gate-dismissed";

function remember() {
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* storage bloqueado */ }
}
function dismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (window.__mpLenis?.scrollTo) window.__mpLenis.scrollTo(el, { offset: -80 });
  else el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function build() {
  const dlg = document.createElement("dialog");
  dlg.className = "entry-gate";
  dlg.setAttribute("aria-label", "Entrar a Frequency Lab");
  dlg.innerHTML = `
    <div class="entry-gate__panel">
      <p class="entry-gate__kicker">Frequency Lab</p>

      <div class="entry-gate__view" data-gate-view="choice">
        <div class="entry-gate__actions">
          <button type="button" class="mp-btn primary" data-gate-start>QUIERO EMPEZAR</button>
          <button type="button" class="mp-btn ghost" data-gate-student>YA SOY ALUMNO</button>
        </div>
      </div>

      <form class="entry-gate__view" data-gate-view="pin" hidden novalidate>
        <label class="entry-gate__label" for="gate-pin">Ingresá tu código de acceso</label>
        <input id="gate-pin" class="entry-gate__pin" type="text" inputmode="numeric"
          autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="······" required />
        <div class="entry-gate__captcha" data-gate-captcha></div>
        <p class="entry-gate__note" data-gate-note role="status" aria-live="polite"></p>
        <button type="submit" class="mp-btn primary" data-gate-submit>ENTRAR</button>
        <div class="entry-gate__links">
          <button type="button" data-gate-back>← Volver</button>
          <a href="#alumnos" data-gate-email>Entrar con email</a>
        </div>
      </form>
    </div>`;
  document.body.appendChild(dlg);
  return dlg;
}

export function initEntryGate() {
  if (document.body.dataset.page !== "clinicas") return;
  if (!hasSupabase() || !supabase || typeof HTMLDialogElement !== "function") return;

  // Vuelta de un magic link, o ya eligió "aplicar": no interrumpir
  const hash = location.hash;
  if (/access_token|error_description|type=/.test(hash)) return;
  if (new URLSearchParams(location.search).has("code")) return;
  if (hash === "#reservar" || dismissed()) return;

  supabase.auth.getSession().then(({ data }) => {
    if (data.session) return; // ya está adentro
    open(hash === "#alumnos" ? "pin" : "choice");
  });
}

function open(initialView) {
  const dlg = build();
  const views = dlg.querySelectorAll("[data-gate-view]");
  const form = dlg.querySelector('[data-gate-view="pin"]');
  const input = dlg.querySelector("#gate-pin");
  const note = dlg.querySelector("[data-gate-note]");
  const submitBtn = dlg.querySelector("[data-gate-submit]");
  let busy = false;

  const show = (name) => {
    views.forEach((v) => { v.hidden = v.dataset.gateView !== name; });
    if (name === "pin") setTimeout(() => input.focus(), 60);
    else dlg.querySelector("[data-gate-start]")?.focus();
  };

  const say = (text, isError = true) => {
    note.textContent = text || "";
    note.classList.toggle("is-error", Boolean(text) && isError);
  };

  const close = (then) => {
    remember();
    dlg.classList.remove("is-in");
    const done = () => {
      dlg.close();
      dlg.remove();
      document.documentElement.classList.remove("gate-open");
      window.__mpLenis?.start?.();
      then?.();
    };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    reduce ? done() : setTimeout(done, 420);
  };

  dlg.querySelector("[data-gate-start]").addEventListener("click", () => close(() => scrollToId("reservar")));
  dlg.querySelector("[data-gate-student]").addEventListener("click", () => show("pin"));
  dlg.querySelector("[data-gate-back]").addEventListener("click", () => { say(""); show("choice"); });
  dlg.querySelector("[data-gate-email]").addEventListener("click", (e) => {
    e.preventDefault();
    close(() => scrollToId("alumnos"));
  });

  // Esc cierra igual que "seguir mirando"
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });

  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, 6);
    if (digits !== input.value) input.value = digits;
    if (note.classList.contains("is-error")) say("");
    if (digits.length === 6) form.requestSubmit();
  });

  // Turnstile se monta recién al abrir la vista del PIN (no carga nada si no hace falta)
  let captcha = null;
  const ensureCaptcha = async () => {
    captcha ||= await mountTurnstile(dlg.querySelector("[data-gate-captcha]"));
    return captcha;
  };
  dlg.querySelector("[data-gate-student]").addEventListener("click", ensureCaptcha);
  if (initialView === "pin") ensureCaptcha();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const pin = input.value.trim();

    busy = true;
    submitBtn.setAttribute("aria-busy", "true");
    submitBtn.disabled = true;
    say("Verificando…", false);

    const c = await ensureCaptcha();
    const result = await loginWithPin(pin, await c.getToken());
    c.reset();

    busy = false;
    submitBtn.removeAttribute("aria-busy");
    submitBtn.disabled = false;

    if (result.ok) {
      say("Listo, entrando…", false);
      remember();
      // El espacio del alumno vive aparte: sin el resto del sitio
      location.href = result.redirect;
      return;
    }
    input.value = "";
    input.focus();
    say(result.message);
  });

  document.documentElement.classList.add("gate-open");
  window.__mpLenis?.stop?.();
  dlg.showModal();
  show(initialView);
  requestAnimationFrame(() => dlg.classList.add("is-in"));
}
