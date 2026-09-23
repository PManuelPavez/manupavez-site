import { supabase, hasSupabase } from "../data/supabaseClient.js";
import { getMaterialAlumnos } from "../data/content.js";
import { getMyStudent, getMySessions, membershipIsActive, isAdmin } from "../data/lab.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Solo http(s): evita javascript: y similares aunque el dato venga de Notion
function safeHref(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "";
  } catch {
    return "";
  }
}

const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, day] = String(d).slice(0, 10).split("-");
  return y && m && day ? `${day}/${m}/${y}` : "";
};

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

  let loadedFor = null;

  function render(session) {
    const isIn = Boolean(session);
    if (loggedOut) loggedOut.hidden = isIn;
    if (loggedIn) loggedIn.hidden = !isIn;
    if (isIn && userLabel) userLabel.textContent = session.user?.email || "";

    if (isIn && loadedFor !== session.user.id) {
      loadedFor = session.user.id;
      loadPortal(session.user);
    }
    if (!isIn) {
      loadedFor = null;
      if (contentArea) contentArea.innerHTML = `<p class="muted">Pronto vas a ver acá el material del Lab, recursos y seguimiento.</p>`;
    }
  }

  async function loadPortal(user) {
    if (!contentArea) return;
    contentArea.innerHTML = `<p class="muted">Cargando tu espacio…</p>`;

    try {
      const [student, admin] = await Promise.all([getMyStudent(user.id), isAdmin()]);
      const adminLink = admin
        ? `<p class="portal-admin"><a class="mp-btn ghost" href="admin.html">PANEL ADMIN →</a></p>`
        : "";

      if (!student) {
        contentArea.innerHTML = adminLink || `<p class="muted">Este email no tiene acceso al Lab. Si creés que es un error, escribime a <a href="mailto:manupavez22@gmail.com">manupavez22@gmail.com</a>.</p>`;
        return;
      }

      if (!membershipIsActive(student.membership)) {
        contentArea.innerHTML = `
          <p class="muted">Hola ${esc(student.full_name)}. Tu acceso al Lab está pausado.</p>
          <p class="muted">Para reactivarlo escribime a <a href="mailto:manupavez22@gmail.com">manupavez22@gmail.com</a>.</p>
          ${adminLink}`;
        return;
      }

      const [sessions, material] = await Promise.all([
        getMySessions(student.id),
        getMaterialAlumnos().catch(() => []),
      ]);

      contentArea.innerHTML = `
        ${adminLink}
        <div class="portal-block">
          <h3 class="portal-title">Tus sesiones</h3>
          ${sessions.length
            ? `<div class="portal-sessions">${sessions.map(renderSession).join("")}</div>`
            : `<p class="muted">Todavía no hay sesiones cargadas. Aparecen acá después de cada encuentro.</p>`}
        </div>
        ${material.length
          ? `<div class="portal-block"><h3 class="portal-title">Material del Lab</h3>${material.map(renderMaterialItem).join("")}</div>`
          : ""}`;
    } catch (err) {
      console.error("[auth] Error cargando portal:", err);
      contentArea.innerHTML = `<p class="muted">No se pudo cargar tu espacio. Probá recargando la página.</p>`;
    }
  }

  function renderSession(s, i) {
    const tasks = Array.isArray(s.tasks) ? s.tasks : [];
    const links = (Array.isArray(s.links) ? s.links : [])
      .map((l) => ({ href: safeHref(l.url), label: l.label || l.url }))
      .filter((l) => l.href);
    const date = fmtDate(s.session_date);

    return `
      <details class="portal-session"${i === 0 ? " open" : ""}>
        <summary>
          <span class="portal-session__num">Sesión ${esc(s.number ?? "")}</span>
          ${date ? `<span class="portal-session__date">${esc(date)}</span>` : ""}
        </summary>
        <div class="portal-session__body">
          ${s.notes ? `<p class="portal-session__notes">${esc(s.notes)}</p>` : ""}
          ${tasks.length ? `
            <h4>Tareas</h4>
            <ul class="portal-tasks">
              ${tasks.map((t) => `<li class="${t.done ? "is-done" : ""}"><span aria-hidden="true">${t.done ? "✓" : "○"}</span> ${esc(t.text)}</li>`).join("")}
            </ul>` : ""}
          ${links.length ? `
            <h4>Links</h4>
            <ul class="portal-links">
              ${links.map((l) => `<li><a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label)}</a></li>`).join("")}
            </ul>` : ""}
        </div>
      </details>`;
  }

  function renderMaterialItem(item) {
    let contentHtml = "";
    const url = safeHref(item.url_contenido);
    if (item.tipo_contenido === "video" && url) {
      contentHtml = `<div class="material-embed"><iframe src="${esc(url)}" frameborder="0" allowfullscreen loading="lazy"></iframe></div>`;
    } else if (item.tipo_contenido === "texto" && item.contenido_texto) {
      contentHtml = `<p class="material-text">${esc(item.contenido_texto)}</p>`;
    } else if (url) {
      contentHtml = `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="mp-btn ghost material-link">Abrir recurso →</a>`;
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
    if (!email || !emailInput.checkValidity()) {
      if (note) note.textContent = "Escribí un email válido.";
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
