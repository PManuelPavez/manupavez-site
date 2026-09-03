import { supabase, hasSupabase } from "../data/supabaseClient.js";
import { getMaterialAlumnos } from "../data/content.js";

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

  let materialLoaded = false;

  function render(session) {
    const isIn = Boolean(session);
    if (loggedOut) loggedOut.hidden = isIn;
    if (loggedIn) loggedIn.hidden = !isIn;
    if (isIn && userLabel) userLabel.textContent = session.user?.email || "";

    if (isIn && !materialLoaded) {
      materialLoaded = true;
      loadMaterial();
    }
    if (!isIn) {
      materialLoaded = false;
      if (contentArea) contentArea.innerHTML = `<p class="muted">Pronto vas a ver acá el material del Lab, recursos y seguimiento.</p>`;
    }
  }

  async function loadMaterial() {
    if (!contentArea) return;
    contentArea.innerHTML = `<p class="muted">Cargando material…</p>`;

    try {
      const items = await getMaterialAlumnos();

      if (!items.length) {
        contentArea.innerHTML = `<p class="muted">Todavía no hay material publicado. Pronto se suma contenido.</p>`;
        return;
      }

      contentArea.innerHTML = items.map(renderMaterialItem).join("");
    } catch (err) {
      console.error("[auth] Error cargando material:", err);
      contentArea.innerHTML = `<p class="muted">No se pudo cargar el material. Probá recargando la página.</p>`;
    }
  }

  function renderMaterialItem(item) {
    const esc = (s) => String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    let contentHtml = "";
    if (item.tipo_contenido === "video" && item.url_contenido) {
      contentHtml = `<div class="material-embed"><iframe src="${esc(item.url_contenido)}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
    } else if (item.tipo_contenido === "texto" && item.contenido_texto) {
      contentHtml = `<p class="material-text">${esc(item.contenido_texto)}</p>`;
    } else if (item.url_contenido) {
      contentHtml = `<a href="${esc(item.url_contenido)}" target="_blank" rel="noopener" class="mp-btn ghost material-link">Abrir recurso →</a>`;
    }

    return `
      <article class="material-card">
        <h4 class="material-card__title">${esc(item.titulo)}</h4>
        ${item.descripcion ? `<p class="material-card__desc muted">${esc(item.descripcion)}</p>` : ""}
        ${contentHtml}
      </article>`;
  }

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
        : "Listo — Te mandé un link a tu mail. Abrilo desde este mismo dispositivo para entrar.";
      note.classList.toggle("is-error", Boolean(error));
    }
    if (!error) form.reset();
  });

  logoutBtn?.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });
}
