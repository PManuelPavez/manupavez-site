export function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderReleases(root, releases = []) {
  if (!root) return;
  if (!releases.length) return;

  const primaryUrl = (r) => {
    const direct = r.spotify_url || r.beatport_url || r.soundcloud_url;
    if (direct) return String(direct);

    let pu = r.platform_urls;
    if (typeof pu === "string") {
      try { pu = JSON.parse(pu); } catch { pu = null; }
    }

    if (Array.isArray(pu)) return String(pu[0]?.url || "");
    if (pu && typeof pu === "object") return String(Object.values(pu)[0] || "");
    return "";
  };

  root.innerHTML = releases
    .map((r, idx) => {
      const id = String(r.id ?? r.slug ?? idx);

      const safeCover = escapeHtml(r.cover_url || "");
      const title = escapeHtml(r.title || "Release");
      const meta = escapeHtml(r.type || "");
      const story = escapeHtml(r.story || "");

      const href = escapeHtml(primaryUrl(r)) || "#";

      // Nota: dejamos el body en DOM (para SEO/lectores), pero en home se puede ocultar por CSS.
      return `
        <article class="release-item mp-card" data-release-id="${id}" tabindex="0">
          <a class="release-link" data-release-id="${id}" href="${href}" ${href === "#" ? 'aria-label="Abrir detalles del release"' : 'aria-label="Abrir detalles del release (Ctrl/⌘ click abre el link directo)"'}>
            <div class="release-thumb">
              ${safeCover ? `<img src="${safeCover}" alt="Portada ${title}" loading="lazy" decoding="async" draggable="false">` : ""}
            </div>
          </a>

          <div class="release-body">
            <h3 class="release-title">${title}</h3>
            ${meta ? `<p class="release-meta">${meta}</p>` : ""}
            ${story ? `<p class="release-story">${story}</p>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
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
