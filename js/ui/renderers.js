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

  root.innerHTML = releases
    .map((r, idx) => {
      const tags = Array.isArray(r.tags)
        ? r.tags
        : (r.tags ? String(r.tags).split(",") : []);

      const actions = [
        r.spotify_url
          ? `<a class="mp-btn platform-btn spotify-btn" href="${escapeHtml(r.spotify_url)}" target="_blank" rel="noopener">
              <span class="platform-icon"><img src="img/icons/spotify.svg" alt="Spotify"></span>
            </a>`
          : "",
        r.beatport_url
          ? `<a class="mp-btn platform-btn beatport-btn" href="${escapeHtml(r.beatport_url)}" target="_blank" rel="noopener">
              <span class="platform-icon"><img src="img/icons/beatport.svg" alt="Beatport"></span>
            </a>`
          : "",
        r.soundcloud_url
          ? `<a class="mp-btn platform-btn" href="${escapeHtml(r.soundcloud_url)}" target="_blank" rel="noopener">
              <span class="platform-icon"><img src="img/icons/soundcloud.svg" alt="SoundCloud"></span>
            </a>`
          : "",
      ].join("");

      return `
        <article class="release-slide release-card ${idx === 0 ? "active" : ""}">
          <div class="release-layout">
            <div class="release-cover">
              <img src="${escapeHtml(r.cover_url || "")}" alt="Portada ${escapeHtml(r.title)}" loading="lazy" decoding="async">
            </div>
            <div class="release-info">
              <h3>${escapeHtml(r.title)}</h3>
              <p class="release-meta">${escapeHtml(r.type || "")}</p>
              <p class="release-story">${escapeHtml(r.story || "")}</p>
              <div class="release-tags">
                ${tags.filter(Boolean).slice(0, 6).map((t) => `<span>${escapeHtml(String(t).trim())}</span>`).join("")}
              </div>
              <div class="release-actions">${actions}</div>
            </div>
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
