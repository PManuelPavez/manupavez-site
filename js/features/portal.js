// portal.js — Espacio del alumno (lo monta /alumnos.html).
// Carga sus datos (RLS: solo ve lo suyo y con acceso vigente), lo dibuja con
// portalView y maneja lo que el alumno puede hacer: subir/borrar tracks y
// marcar misiones. Cada acción la valida la base; acá solo se refleja.
import { getMyPortal, adminStudentPortal, addTrack, deleteTrack, setTaskCheck, membershipIsActive, getNotionFileUrl } from "../data/lab.js";
import { renderPortal, renderTrackList, displayName, esc, safeHref } from "./portalView.js";

// Link pegado sin "https://" (ej: soundcloud.com/…) → se completa. Solo https.
function normalizeTrackUrl(raw) {
  let v = String(raw || "").trim();
  if (v && !/^[a-z]+:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    return u.protocol === "https:" && u.hostname.includes(".") ? u.href : "";
  } catch {
    return "";
  }
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

/**
 * Monta el portal del usuario logueado en `container`.
 * Con { previewStudentId } (solo admin) muestra la página de ese alumno en solo lectura.
 * Devuelve { name } para que la página arme su encabezado (o null si no hay acceso).
 */
export async function mountPortal(container, { previewStudentId = null } = {}) {
  const readOnly = Boolean(previewStudentId);
  let tracks = [];
  let checks = new Map();

  const refreshTracks = () => {
    const list = container.querySelector("[data-track-list]");
    if (list) list.innerHTML = renderTrackList(tracks);
  };

  const toggleTrackForm = (open) => {
    const form = container.querySelector("[data-track-form]");
    const addBtn = container.querySelector("[data-track-add]");
    if (!form || !addBtn) return;
    form.hidden = !open;
    addBtn.hidden = open;
    if (open) form.querySelector('[name="title"]')?.focus();
    else { form.reset(); form.querySelector("[data-track-note]").textContent = ""; }
  };

  container.addEventListener("click", async (e) => {
    // Archivo subido a Notion: la pestaña se abre YA (si no, el bloqueador de popups la
    // frena) y recibe el link fresco apenas llega. Funciona también en la vista previa.
    const fileBtn = e.target.closest("[data-notion-file]");
    if (fileBtn) {
      if (fileBtn.getAttribute("aria-busy") === "true") return;
      fileBtn.setAttribute("aria-busy", "true");
      const win = window.open("", "_blank");
      if (win) win.opener = null;
      try {
        const url = await getNotionFileUrl(fileBtn.dataset.notionFile);
        if (win) win.location.href = url;
        else location.href = url;
      } catch (err) {
        win?.close();
        alert(err.message);
      } finally {
        fileBtn.removeAttribute("aria-busy");
      }
      return;
    }

    if (readOnly) return;
    if (e.target.closest("[data-track-add]")) return toggleTrackForm(true);
    if (e.target.closest("[data-track-cancel]")) return toggleTrackForm(false);

    // Misión: marcar / desmarcar (optimista, se revierte si la base no acepta)
    const box = e.target.closest("[data-task-key]");
    if (box && !box.disabled) {
      const key = box.dataset.taskKey;
      const next = box.getAttribute("aria-checked") !== "true";
      const li = box.closest("li");
      const paint = (on) => {
        box.setAttribute("aria-checked", String(on));
        box.textContent = on ? "✓" : "";
        li?.classList.toggle("is-done", on);
      };
      paint(next);
      box.disabled = true;
      try {
        await setTaskCheck(key, next);
        checks.set(key, next);
      } catch (err) {
        paint(!next);
        alert(err.message);
      } finally {
        box.disabled = false;
      }
      return;
    }

    const del = e.target.closest("[data-track-del]");
    if (!del) return;
    const row = del.closest("[data-track-id]");
    const track = tracks.find((t) => t.id === row?.dataset.trackId);
    if (!track || !confirm(`¿Borrar "${track.title}" de tus tracks?`)) return;
    del.disabled = true;
    try {
      await deleteTrack(track.id);
      tracks = tracks.filter((t) => t.id !== track.id);
      refreshTracks();
    } catch (err) {
      del.disabled = false;
      alert(err.message);
    }
  });

  container.addEventListener("submit", async (e) => {
    if (readOnly) return;
    const form = e.target.closest("[data-track-form]");
    if (!form) return;
    e.preventDefault();
    const note = form.querySelector("[data-track-note]");
    // form.title es el atributo del <form>: los campos se leen por elements
    const titleInput = form.elements.namedItem("title");
    const urlInput = form.elements.namedItem("url");
    const title = titleInput.value.trim();
    const url = normalizeTrackUrl(urlInput.value);
    const say = (text, isError = true) => { note.textContent = text; note.classList.toggle("is-error", isError); };

    if (!title) { say("Poné un título."); titleInput.focus(); return; }
    if (!url) { say("El link tiene que empezar con https:// (SoundCloud, Drive, Dropbox…)."); urlInput.focus(); return; }

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    say("Guardando…", false);
    try {
      const saved = await addTrack({ title, url });
      tracks = [saved, ...tracks];
      refreshTracks();
      toggleTrackForm(false);
    } catch (err) {
      say(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  container.innerHTML = `<p class="muted">Cargando tu espacio…</p>`;

  try {
    // Un solo pedido con todo (cada ida a Supabase cuesta ~0,6 s de red)
    const data = previewStudentId ? await adminStudentPortal(previewStudentId) : await getMyPortal();
    const { student } = data;
    const admin = data.isAdmin;
    const adminLink = admin
      ? `<p class="portal-admin"><a class="mp-btn ghost small" href="admin.html">${readOnly ? "← VOLVER AL PANEL" : "PANEL ADMIN →"}</a></p>`
      : "";

    if (!student) {
      container.innerHTML = admin
        ? `<p class="muted">Tu cuenta es de admin y no tiene página de alumno.</p>${adminLink}`
        : `<p class="muted">Este acceso no tiene un espacio en el Lab. Si creés que es un error, escribime a <a href="mailto:manupavez22@gmail.com">manupavez22@gmail.com</a>.</p>`;
      return null;
    }

    if (!membershipIsActive(student.membership) && !readOnly) {
      container.innerHTML = `
        <div class="portal-paused">
          <p>Hola ${esc(displayName(student.full_name))}. Tu acceso al Lab está pausado.</p>
          <p class="muted">Para reactivarlo escribime a <a href="mailto:manupavez22@gmail.com">manupavez22@gmail.com</a>.</p>
          ${adminLink}
        </div>`;
      return { name: displayName(student.full_name) };
    }

    tracks = data.tracks;
    checks = data.checks;
    const { sessions, dashboard, material } = data;

    container.innerHTML =
      (readOnly ? `<p class="portal-preview">Vista previa: así ve <strong>${esc(displayName(student.full_name))}</strong> su espacio${membershipIsActive(student.membership) ? "" : " (hoy tiene el acceso pausado: él ve solo el aviso)"}. Solo lectura.</p>` : "") +
      renderPortal({ student, dashboard, sessions, tracks, checks, material, adminLink, renderMaterialItem, readOnly });
    return { name: displayName(student.full_name) };
  } catch (err) {
    console.error("[portal] Error cargando:", err);
    container.innerHTML = `<p class="muted">No se pudo cargar tu espacio. Probá recargando la página.</p>`;
    return null;
  }
}
