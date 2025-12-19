import { getFocusable } from "../core/dom.js";

/**
 * Bindea clicks en .release-link dentro de `root` y abre un <dialog> con data del release.
 * - Ctrl/⌘ click: deja que el link abra normal (nueva pestaña si corresponde).
 * - Accesible: ESC, click afuera, botón cerrar, focus restore.
 */
export function bindReleaseModal(root, getReleaseById) {
  if (!root || root.dataset.releaseModalBound === "true") return;
  root.dataset.releaseModalBound = "true";

  const dialogApi = ensureReleaseDialog();

  root.addEventListener("click", (e) => {
    const a = e.target.closest(".release-link");
    if (!a || !root.contains(a)) return;

    // No seas policía: si quieren Ctrl/⌘ click, que vuelen libres 🕊️
    if (isModifiedClick(e)) return;

    const id = a.getAttribute("data-release-id") || a.closest("[data-release-id]")?.getAttribute("data-release-id");
    const release = id ? getReleaseById(String(id)) : null;
    if (!release) return;

    e.preventDefault();
    dialogApi.open(release, a);
  });
}

function isModifiedClick(e) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1;
}

function ensureReleaseDialog() {
  let dialog = document.querySelector("dialog[data-release-dialog]");
  if (dialog) return makeApi(dialog);

  dialog = document.createElement("dialog");
  dialog.setAttribute("data-release-dialog", "true");
  dialog.className = "release-dialog";

  // Estructura mínima: default dialog UI funciona sin CSS.
  dialog.innerHTML = `
    <div class="release-dialog__inner">
      <button type="button" class="release-dialog__close" data-release-close aria-label="Cerrar">✕</button>

      <figure class="release-dialog__figure">
        <img data-release-cover alt="" loading="eager" decoding="async">
      </figure>

      <header class="release-dialog__header">
        <h2 data-release-title></h2>
        <p data-release-subtitle></p>
      </header>

      <div class="release-dialog__story" data-release-story></div>

      <div class="release-dialog__actions" data-release-actions></div>
    </div>
  `;

  document.body.appendChild(dialog);
  return makeApi(dialog);
}

function makeApi(dialog) {
  const closeBtn = dialog.querySelector("[data-release-close]");
  const cover = dialog.querySelector("[data-release-cover]");
  const title = dialog.querySelector("[data-release-title]");
  const subtitle = dialog.querySelector("[data-release-subtitle]");
  const story = dialog.querySelector("[data-release-story]");
  const actions = dialog.querySelector("[data-release-actions]");

  let lastFocus = null;
  let untrap = () => {};

  const close = () => {
    try { dialog.close(); } catch { dialog.removeAttribute("open"); }
    untrap();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  };

  const open = (release, openerEl) => {
    // Si el browser no soporta <dialog>, degradamos sin drama:
    if (typeof dialog.showModal !== "function") {
      const primary = pickPrimaryUrl(release);
      if (primary) window.open(primary, "_blank", "noopener");
      return;
    }

    lastFocus = openerEl || document.activeElement;

    // Populate
    const t = release.title || release.name || "Release";
    const sub = release.subtitle || release.type || "";
    const st = release.story || release.description || "";

    const imgUrl = release.cover_url || release.cover || release.image_url || "";
    cover.src = imgUrl;
    cover.alt = t ? `Portada ${t}` : "Portada";
    title.textContent = t;
    subtitle.textContent = sub;

    // Story como párrafos (sin HTML injection)
    story.innerHTML = "";
    const parts = String(st).split("\n\n").map(s => s.trim()).filter(Boolean);
    if (parts.length) {
      for (const p of parts) {
        const el = document.createElement("p");
        el.textContent = p;
        story.appendChild(el);
      }
    }

    // Actions
    actions.innerHTML = "";
    const links = extractPlatformLinks(release);
    for (const { label, url } of links) {
      const a = document.createElement("a");
      a.className = "mp-btn platform-btn";
      a.textContent = label;
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      actions.appendChild(a);
    }

    dialog.showModal();

    // Focus: al abrir va al botón cerrar
    closeBtn?.focus?.();
    untrap = trapFocus(dialog);

    // Cerrar: botón
    closeBtn?.addEventListener("click", close, { once: true });
  };

  // ESC
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });

  // Click afuera (backdrop)
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });

  // Por si alguien cierra via dialog.close() externo
  dialog.addEventListener("close", () => {
    untrap();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  });

  return { open, close };
}

function trapFocus(container) {
  const onKeydown = (e) => {
    if (e.key !== "Tab") return;

    const focusables = getFocusable(container);
    if (!focusables.length) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  container.addEventListener("keydown", onKeydown);
  return () => container.removeEventListener("keydown", onKeydown);
}

function extractPlatformLinks(release) {
  // Soporta:
  // - platform_urls (obj, array, JSON string)
  // - campos sueltos: spotify_url, beatport_url, soundcloud_url, youtube_url, bandcamp_url...
  const out = [];

  const add = (label, url) => {
    if (!url) return;
    const u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) return;
    if (out.some((x) => x.url === u)) return;
    out.push({ label, url: u });
  };

  let pu = release.platform_urls;

  if (typeof pu === "string") {
    try { pu = JSON.parse(pu); } catch { pu = null; }
  }

  if (Array.isArray(pu)) {
    for (const it of pu) add(it.label || it.platform || "Link", it.url);
  } else if (pu && typeof pu === "object") {
    for (const [k, v] of Object.entries(pu)) add(prettyPlatform(k), v);
  }

  add("Spotify", release.spotify_url || release.spotify);
  add("Beatport", release.beatport_url || release.beatport);
  add("SoundCloud", release.soundcloud_url || release.soundcloud);
  add("YouTube", release.youtube_url || release.youtube);
  add("Bandcamp", release.bandcamp_url || release.bandcamp);

  return out;
}

function prettyPlatform(key) {
  const k = String(key).toLowerCase();
  if (k.includes("spotify")) return "Spotify";
  if (k.includes("beatport")) return "Beatport";
  if (k.includes("soundcloud")) return "SoundCloud";
  if (k.includes("youtube")) return "YouTube";
  if (k.includes("bandcamp")) return "Bandcamp";
  return key;
}

function pickPrimaryUrl(release) {
  const links = extractPlatformLinks(release);
  return links[0]?.url || "";
}
