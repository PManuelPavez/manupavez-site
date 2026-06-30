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

  const yearOf = (r) => String(r.released_at || "").slice(0, 4);
  const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
  // Meta estilo discografía. Si la fila trae `subtitle` (Supabase), se usa tal
  // cual (ahí editás "Sello • Año"). Si no, se arma "Sello • Año" con label/tipo.
  const metaOf = (r) => {
    if (r.subtitle) return escapeHtml(r.subtitle);
    const left = r.label || capitalize(r.type) || "";
    const year = yearOf(r);
    return [escapeHtml(left), year ? `<span class="track-card__dot" aria-hidden="true">•</span>${escapeHtml(year)}` : ""]
      .filter(Boolean)
      .join("");
  };

  root.innerHTML = releases
    .map((r, idx) => {
      const id = String(r.id ?? r.slug ?? idx);
      const safeCover = escapeHtml(r.cover_url || "");
      const title = escapeHtml(r.title || "Release");
      const meta = metaOf(r);
      const href = escapeHtml(primaryUrl(r));

      const tag = href ? "a" : "article";
      const attrs = href
        ? `href="${href}" target="_blank" rel="noopener noreferrer" aria-label="Escuchar ${title} en Spotify — se abre en una pestaña nueva"`
        : "";

      return `
        <${tag} class="track-card${href ? " track-card--link" : ""}" data-release-id="${id}" ${attrs}>
          <div class="track-card__art">
            <span class="track-card__disc" aria-hidden="true"></span>
            <div class="track-card__cover">
              ${safeCover ? `<img src="${safeCover}" alt="Portada — ${title}" width="320" height="320" loading="lazy" decoding="async" draggable="false">` : ""}
            </div>
          </div>
          <h3 class="track-card__title">${title}</h3>
          ${meta ? `<p class="track-card__meta">${meta}</p>` : ""}
        </${tag}>
      `;
    })
    .join("");
}

// LIVE SETS — lista numerada tipo acordeón (estilo Nacho Scoppa).
// Cada item: índice (001), nombre, panel desplegable con detalle + CTA, y una
// imagen de preview que aparece detrás al hacer hover/abrir.
export function renderLiveSets(root, sets = []) {
  if (!root) return;
  if (!sets.length) return;

  const pad = (n) => String(n + 1).padStart(3, "0");

  root.innerHTML = sets
    .map((s, idx) => {
      const name = escapeHtml(s.venue || s.title || "Set");
      const sub = [s.city, s.date].filter(Boolean).map(escapeHtml).join(" · ");
      const detail = escapeHtml(s.detail || "");
      const preview = escapeHtml(s.preview_src || "");
      const url = escapeHtml(s.stream_url || "");
      const listen = escapeHtml(s.listen_label || "Escuchar");
      const panelId = `live-set-panel-${idx}`;

      return `
        <li class="live-sets__item">
          <div class="live-sets__main-col">
            <div class="live-sets__row" data-live-row>
              ${preview ? `<span class="live-sets__preview-bg" style="background-image:url('${preview}')" aria-hidden="true"></span>` : ""}
              <div class="live-sets__index-col"><span class="live-sets__index">${pad(idx)}</span></div>
              <button class="live-sets__trigger" type="button" aria-expanded="false" aria-controls="${panelId}" data-live-trigger>
                <span class="live-sets__trigger-main">
                  <span class="live-sets__name">${name}</span>
                  ${sub ? `<span class="live-sets__sub">${sub}</span>` : ""}
                </span>
                <span class="live-sets__icon-wrap" aria-hidden="true"><span class="live-sets__icon"></span></span>
              </button>
              <div class="live-sets__panel" id="${panelId}">
                <div class="live-sets__panel-measure">
                  <div class="live-sets__panel-inner">
                    ${detail ? `<p class="live-sets__detail">${detail}</p>` : ""}
                    ${url ? `<a class="live-sets__youtube-cta" href="${url}" target="_blank" rel="noopener noreferrer">${listen} <span class="live-sets__youtube-cta-arrow" aria-hidden="true">→</span></a>` : ""}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </li>
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
