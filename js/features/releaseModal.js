import { getFocusable } from "../core/dom.js";

/**
 * Bindea modal de releases dentro de `root`.
 * Requiere anchors con clase `.release-link` y `data-release-id`.
 */
export function bindReleaseModal(root, getReleaseById) {
  if (!root) return;
  if (root.dataset.releaseModalBound === "1") return;
  root.dataset.releaseModalBound = "1";

  const dialogApi = ensureReleaseDialog();

  root.addEventListener("click", (e) => {
    const a = e.target.closest(".release-link");
    if (!a || !root.contains(a)) return;

    // Ctrl/⌘/Shift/Alt click = no seas policía
    if (isModifiedClick(e)) return;

    const id =
      a.getAttribute("data-release-id") ||
      a.closest("[data-release-id]")?.getAttribute("data-release-id");

    if (!id) return;
    const release = getReleaseById?.(String(id));
    if (!release) return;

    e.preventDefault();
    dialogApi.open(release, a);
  });

  // Accesibilidad: Enter/Espacio sobre la card abre modal
  root.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;

    // Si estás parado en un control, dejalo vivir
    if (e.target?.matches?.("a,button,input,select,textarea")) return;

    const card = e.target.closest("[data-release-id]");
    if (!card || !root.contains(card)) return;

    const id = card.getAttribute("data-release-id");
    const release = getReleaseById?.(String(id));
    if (!release) return;

    e.preventDefault();
    dialogApi.open(release, card.querySelector(".release-link") || card);
  });
}

function isModifiedClick(e) {
  return e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1;
}

function ensureReleaseDialog() {
  let dialog = document.querySelector("dialog[data-release-dialog]");
  if (!dialog) {
    injectDialogStyles();
    dialog = document.createElement("dialog");
    dialog.setAttribute("data-release-dialog", "1");
    dialog.className = "release-dialog";
    dialog.innerHTML = `
      <div class="release-dialog__panel" role="document">
        <button type="button" class="release-dialog__close" data-release-close aria-label="Cerrar">✕</button>

        <div class="release-dialog__grid">
          <figure class="release-dialog__cover">
            <img data-release-cover alt="" loading="eager" decoding="async" />
          </figure>

          <div class="release-dialog__content">
            <header class="release-dialog__header">
              <h3 class="release-dialog__title" data-release-title></h3>
              <p class="release-dialog__subtitle" data-release-subtitle></p>
            </header>

            <div class="release-dialog__story" data-release-story></div>

            <div class="release-dialog__links" data-release-links></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(dialog);
  }

  const closeBtn = dialog.querySelector("[data-release-close]");
  const coverImg = dialog.querySelector("[data-release-cover]");
  const titleEl = dialog.querySelector("[data-release-title]");
  const subtitleEl = dialog.querySelector("[data-release-subtitle]");
  const storyEl = dialog.querySelector("[data-release-story]");
  const linksEl = dialog.querySelector("[data-release-links]");

  let lastFocus = null;
  let untrap = () => {};

  const close = () => {
    try {
      dialog.close();
    } catch {
      dialog.removeAttribute("open");
    }
    untrap();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  };

  const open = (release, opener) => {
    // Fallback si <dialog> no existe
    if (typeof dialog.showModal !== "function") {
      const primary = pickPrimaryUrl(release);
      if (primary) window.open(primary, "_blank", "noopener");
      return;
    }

    lastFocus = opener || document.activeElement;

    const title = release.title || release.name || "Release";
    const subtitle = release.subtitle || release.type || "";
    const story = release.story || release.description || "";

    const cover = release.cover_url || release.cover || release.image_url || "";
    coverImg.src = cover;
    coverImg.alt = title ? `Portada ${title}` : "Portada";

    titleEl.textContent = title;

    if (subtitle) {
      subtitleEl.textContent = subtitle;
      subtitleEl.style.display = "block";
    } else {
      subtitleEl.textContent = "";
      subtitleEl.style.display = "none";
    }

    // Story a párrafos (sin HTML crudo)
    storyEl.innerHTML = "";
    const parts = String(story)
      .split("\n\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (parts.length) {
      for (const p of parts) {
        const el = document.createElement("p");
        el.textContent = p;
        storyEl.appendChild(el);
      }
      storyEl.style.display = "block";
    } else {
      storyEl.style.display = "none";
    }

    // Links
    linksEl.innerHTML = "";
    const links = extractPlatformLinks(release);
    if (links.length) {
      for (const { label, url } of links) {
        const a = document.createElement("a");
        a.className = "mp-btn platform-btn";
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = label;
        linksEl.appendChild(a);
      }
    } else {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.textContent = "No hay links cargados para este release todavía.";
      linksEl.appendChild(hint);
    }

    dialog.showModal();

    // Focus management
    closeBtn?.focus?.();
    untrap = trapFocus(dialog);

    closeBtn?.addEventListener("click", close, { once: true });
  };

  // ESC
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });

  // Click afuera
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });

  dialog.addEventListener("close", () => {
    untrap();
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
  });

  return { open, close };
}

function injectDialogStyles() {
  if (document.getElementById("mp-release-dialog-styles")) return;
  const style = document.createElement("style");
  style.id = "mp-release-dialog-styles";
  style.textContent = `
    dialog.release-dialog {
      border: 0;
      padding: 0;
      background: transparent;
      max-width: min(820px, calc(100vw - 32px));
    }
    dialog.release-dialog::backdrop {
      background: rgba(0,0,0,.55);
      backdrop-filter: blur(10px);
    }
    .release-dialog__panel {
      position: relative;
      background: rgba(8,8,12,.92);
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 18px;
      box-shadow: 0 30px 80px rgba(0,0,0,.6);
      padding: 18px;
    }
    .release-dialog__close {
      position: absolute;
      top: 10px;
      right: 10px;
      width: 36px;
      height: 36px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,.2);
      background: rgba(0,0,0,.35);
      color: #fff;
      cursor: pointer;
    }
    .release-dialog__grid {
      display: grid;
      grid-template-columns: 220px 1fr;
      gap: 16px;
      align-items: start;
    }
    @media (max-width: 680px) {
      .release-dialog__grid { grid-template-columns: 1fr; }
      .release-dialog__cover { max-width: 320px; margin: 0 auto; }
    }
    .release-dialog__cover {
      margin: 0;
      border-radius: 14px;
      overflow: hidden;
      background: #000;
      aspect-ratio: 1 / 1;
    }
    .release-dialog__cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .release-dialog__title {
      margin: 0 0 6px 0;
      font-size: 1.05rem;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .release-dialog__subtitle {
      margin: 0 0 10px 0;
      opacity: .75;
      letter-spacing: .18em;
      text-transform: uppercase;
      font-size: .78rem;
    }
    .release-dialog__story p {
      margin: 0 0 10px 0;
      opacity: .9;
      line-height: 1.6;
    }
    .release-dialog__links {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-top: 10px;
    }
  `;
  document.head.appendChild(style);
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
  const out = [];

  const add = (label, url) => {
    if (!url) return;
    const u = String(url).trim();
    if (!/^https?:\/\//i.test(u)) return;
    if (out.some((x) => x.url === u)) return;
    out.push({ label, url: u });
  };

  // 1) platform_urls (obj, array, JSON string)
  let pu = release.platform_urls;
  if (typeof pu === "string") {
    try {
      pu = JSON.parse(pu);
    } catch {
      pu = null;
    }
  }

  if (Array.isArray(pu)) {
    for (const it of pu) add(it.label || it.platform || "Link", it.url);
  } else if (pu && typeof pu === "object") {
    for (const [k, v] of Object.entries(pu)) add(prettyPlatform(k), v);
  }

  // 2) campos sueltos (compat)
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
  return String(key);
}

function pickPrimaryUrl(release) {
  const links = extractPlatformLinks(release);
  return links[0]?.url || release.spotify_url || release.beatport_url || release.soundcloud_url || "";
}
