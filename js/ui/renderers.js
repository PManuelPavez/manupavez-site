export function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderReleases(root, releases = [], opts = {}) {
  if (!root) return;
  if (!releases.length) {
    root.innerHTML = "";
    return;
  }

  const mode = opts.mode || "replace";
  if (mode === "replace") root.innerHTML = "";

  const tpl = document.getElementById("tpl-release");
  if (!(tpl instanceof HTMLTemplateElement)) {
    // Fallback: si no hay template, degradamos al render viejo (simple)
    root.innerHTML = releases
      .map((r) => {
        const img = escapeHtml(r.cover_url || "");
        const title = escapeHtml(r.title || "Release");
        const href = escapeHtml(pickPrimaryUrl(r) || "#");
        const id = escapeHtml(String(r.__mp_id ?? r.id ?? ""));
        return `
          <article class="release-slide" data-release-id="${id}">
            <a class="release-link" href="${href}" data-release-id="${id}">
              <img src="${img}" alt="Portada ${title}" loading="lazy" decoding="async">
            </a>
          </article>
        `;
      })
      .join("");
    return;
  }

  const frag = document.createDocumentFragment();

  releases.forEach((r, idx) => {
    const id = String(r.__mp_id ?? r.id ?? idx);
    const nodeFrag = tpl.content.cloneNode(true);
    const el = nodeFrag.firstElementChild || nodeFrag.querySelector?.("*");

    // Relleno “robusto” (no depende de un único selector)
    const coverImg =
      nodeFrag.querySelector?.(".release-cover img") ||
      nodeFrag.querySelector?.("img");

    if (coverImg) {
      coverImg.src = r.cover_url || r.cover || r.image_url || "";
      coverImg.alt = (r.title || r.name) ? `Portada ${r.title || r.name}` : "Portada";
      coverImg.loading = "lazy";
      coverImg.decoding = "async";
    }

    const titleEl =
      nodeFrag.querySelector?.(".release-title") ||
      nodeFrag.querySelector?.(".release-info h3") ||
      nodeFrag.querySelector?.("h3");

    if (titleEl) titleEl.textContent = r.title || r.name || "";

    const subEl =
      nodeFrag.querySelector?.(".release-meta") ||
      nodeFrag.querySelector?.("[data-release-subtitle]");

    if (subEl) subEl.textContent = r.subtitle || r.type || "";

    const storyEl =
      nodeFrag.querySelector?.(".release-story") ||
      nodeFrag.querySelector?.("[data-release-story]");

    if (storyEl) storyEl.textContent = r.story || r.description || "";

    // Link principal (para Ctrl/⌘ click)
    const a =
      nodeFrag.querySelector?.(".release-link") ||
      nodeFrag.querySelector?.("a[href]");

    const href = pickPrimaryUrl(r) || "#";

    if (a) {
      a.href = href;
      a.setAttribute("data-release-id", id);
    }

    // Set id en el root del ítem
    if (el) el.setAttribute("data-release-id", id);

    frag.appendChild(nodeFrag);
  });

  root.appendChild(frag);
}

function pickPrimaryUrl(release) {
  const links = extractPlatformLinks(release);
  return links[0]?.url || "";
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

  let pu = release.platform_urls;
  if (typeof pu === "string") {
    try { pu = JSON.parse(pu); } catch { pu = null; }
  }
  if (Array.isArray(pu)) {
    for (const it of pu) add(it.label || it.platform || "Link", it.url);
  } else if (pu && typeof pu === "object") {
    for (const [k, v] of Object.entries(pu)) add(String(k), v);
  }

  add("Spotify", release.spotify_url || release.spotify);
  add("Beatport", release.beatport_url || release.beatport);
  add("SoundCloud", release.soundcloud_url || release.soundcloud);
  add("YouTube", release.youtube_url || release.youtube);
  add("Bandcamp", release.bandcamp_url || release.bandcamp);

  return out;
}

export function renderLabels(track, items = []) {
  if (!track) return;
  if (!items.length) return;

  const pill = (it) => {
    const cls = it.is_support_line ? "label-pill small-text" : "label-pill";
    const img = it.logo_url
      ? `<img src="${escapeHtml(it.logo_url)}" alt="${escapeHtml(it.name)}" loading="lazy" decoding="async">`
      : "";
    return `<div class="${cls}">${img}<span>${escapeHtml(it.name)}</span></div>`;
  };

  // Duplicamos para loop infinito (marquee)
  track.innerHTML = items.map(pill).join("") + items.map(pill).join("");
}

export function renderMedia(root, items = [], kind) {
  if (!root) return;
  if (!items.length) return;

  root.innerHTML = items
    .map((m, idx) => {
      const isMix = kind === "mix";
      const iframe = isMix
        ? `<iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="${escapeHtml(m.embed_url)}"></iframe>`
        : `<iframe width="560" height="315" src="${escapeHtml(m.embed_url)}" title="${escapeHtml(m.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;

      return `
        <article class="media-slide ${idx === 0 ? "active" : ""}">
          <div class="media-embed ${isMix ? "mix" : ""}">${iframe}</div>
          <div class="media-caption">
            <h4>${escapeHtml(m.title)}</h4>
            <p>${escapeHtml(m.description || "")}</p>
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderPresskitGallery(slidesRoot, assets = []) {
  if (!slidesRoot) return;
  if (!assets.length) return;

  slidesRoot.innerHTML = assets
    .map((img, idx) => {
      return `<img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.title || "Manu Pavez")}" class="${idx === 0 ? "active" : ""}" loading="lazy" decoding="async">`;
    })
    .join("");
}

// Alias compatible con pages/presskit.js (y con el pedido de "fotos que cambian")
// Render simple: imágenes dentro del track del slider.
export function renderPresskitPhotos(container, photos = [], { mode = "replace" } = {}) {
  if (!container) return;
  if (!photos.length) return;

  const track = container.getAttribute("data-sb") === "presskit-slides"
    ? container
    : (container.querySelector("[data-sb='presskit-slides']") || container);

  if (mode === "replace") track.innerHTML = "";

  track.innerHTML = photos
    .map((img, idx) =>
      `<img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.alt || img.title || 'Manu Pavez')}" class="${idx === 0 ? 'active' : ''}" loading="lazy" decoding="async">`
    )
    .join("");
}

export function renderNavList(root, items = []) {
  if (!root) return;
  if (!items.length) return;

  root.innerHTML = items
    .map((it) => {
      const href = escapeHtml(it.href || it.url || "#");
      const label = escapeHtml(it.label || it.title || it.text || "Link");
      const cls = it.is_cta ? "cta-book" : "";
      return `<li><a href="${href}" class="${cls}">${label}</a></li>`;
    })
    .join("");
}

export function renderSiteLinks(root, links = []) {
  if (!root) return;
  if (!links.length) return;

  // Si la tabla ya trae svg/html, preferimos no inyectar HTML crudo por seguridad.
  // Render básico: texto + aria-label.
  root.innerHTML = links
    .map((l) => {
      const href = escapeHtml(l.href || l.url || "#");
      const label = escapeHtml(l.label || l.name || "Link");
      return `<a href="${href}" aria-label="${label}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .join("");
}

export function renderClinics(root, items = []) {
  if (!root) return;
  if (!items.length) return;

  root.innerHTML = items
    .map((c) => {
      const bullets = Array.isArray(c.bullets)
        ? c.bullets
        : (c.bullets ? String(c.bullets).split("\n") : []);

      return `
        <article class="clinic-card reveal" data-reveal>
          <h3>${escapeHtml(c.title)}</h3>
          ${c.subtitle ? `<p class="muted">${escapeHtml(c.subtitle)}</p>` : ""}
          ${c.description ? `<p>${escapeHtml(c.description)}</p>` : ""}
          ${bullets.length ? `<ul class="clinic-list">${bullets.filter(Boolean).slice(0, 10).map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
          <div class="clinic-actions">
            ${c.price ? `<span class="clinic-price">${escapeHtml(c.price)}</span>` : ""}
            ${c.cta_url ? `<a class="mp-btn primary" href="${escapeHtml(c.cta_url)}" target="_blank" rel="noopener">${escapeHtml(c.cta_label || "Consultar")}</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

export function renderTextBlocks(nodes = [], blockMap = new Map()) {
  for (const node of nodes) {
    const key = node.getAttribute("data-sb-block");
    const content = blockMap.get(key);
    if (content == null) continue;

    const parts = String(content).split("\n\n").filter(Boolean);
    node.innerHTML = parts.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  }
}
