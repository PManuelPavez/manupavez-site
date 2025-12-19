// js/app.js (ESM)
// Render dinámico desde Supabase: releases, labels, media, presskit, clínicas, bloques de texto.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const cfg = window.MP_SUPABASE || {};

function ready(fn) {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
  else fn();
}

function q(sel, root = document) {
  return root.querySelector(sel);
}

function qa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function hasSupabaseConfig() {
  return cfg.url && cfg.anonKey && !cfg.url.includes("YOUR_") && !cfg.anonKey.includes("YOUR_");
}

function warnMissingConfig() {
  const banners = qa("[data-supabase-banner]");
  if (!banners.length) return;
  banners.forEach((b) => {
    b.hidden = false;
  });
}

function initClient() {
  if (!hasSupabaseConfig()) return null;
  return createClient(cfg.url, cfg.anonKey);
}

async function fetchAll({ supabase }) {
  // Ejecutamos en paralelo, y cada sección renderiza si existe el contenedor.
  await Promise.allSettled([
    renderReleases({ supabase }),
    renderLabels({ supabase }),
    renderMedia({ supabase, kind: "video" }),
    renderMedia({ supabase, kind: "mix" }),
    renderPresskit({ supabase }),
    renderClinics({ supabase }),
    renderPageBlocks({ supabase }),
    hookBookingForm({ supabase }),
  ]);

  // Re-inicializa sliders si existen (los define slider.js)
  if (window.MP_initReleaseSlider) window.MP_initReleaseSlider();
  if (window.MP_initMediaSliders) window.MP_initMediaSliders();
  if (window.MP_initPresskitPhotoSlider) window.MP_initPresskitPhotoSlider();
}

async function renderReleases({ supabase }) {
  const root = q("[data-sb='releases']");
  if (!root) return;

  const { data, error } = await supabase
    .from("releases")
    .select("id,title,type,story,tags,cover_url,spotify_url,beatport_url,soundcloud_url,released_at,is_featured")
    .order("released_at", { ascending: false });

  if (error) {
    console.warn("Supabase releases error:", error);
    return;
  }

  const releases = (data || []).filter((r) => r.is_featured !== false);
  if (!releases.length) return;

  root.innerHTML = releases
    .map((r, idx) => {
      const tags = Array.isArray(r.tags) ? r.tags : (r.tags ? String(r.tags).split(",") : []);
      const actions = [
        r.spotify_url
          ? `<a class="mp-btn platform-btn spotify-btn" href="${escapeHtml(r.spotify_url)}" target="_blank" rel="noopener">\
              <span class="platform-icon"><img src="img/icons/spotify.svg" alt="Spotify"></span>\
            </a>`
          : "",
        r.beatport_url
          ? `<a class="mp-btn platform-btn beatport-btn" href="${escapeHtml(r.beatport_url)}" target="_blank" rel="noopener">\
              <span class="platform-icon"><img src="img/icons/beatport.svg" alt="Beatport"></span>\
            </a>`
          : "",
        r.soundcloud_url
          ? `<a class="mp-btn platform-btn" href="${escapeHtml(r.soundcloud_url)}" target="_blank" rel="noopener">\
              <span class="platform-icon"><img src="img/icons/soundcloud.svg" alt="SoundCloud"></span>\
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
                ${tags.filter(Boolean).slice(0, 6).map((t) => `<span>${escapeHtml(t.trim())}</span>`).join("")}
              </div>
              <div class="release-actions">${actions}</div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

async function renderLabels({ supabase }) {
  const track = q("[data-sb='labels-track']");
  if (!track) return;

  const { data, error } = await supabase
    .from("labels")
    .select("name,logo_url,is_support_line,order")
    .order("order", { ascending: true });

  if (error) {
    console.warn("Supabase labels error:", error);
    return;
  }

  const items = data || [];
  if (!items.length) return;

  const pill = (it) => {
    const cls = it.is_support_line ? "label-pill small-text" : "label-pill";
    const img = it.logo_url ? `<img src="${escapeHtml(it.logo_url)}" alt="${escapeHtml(it.name)}" loading="lazy" decoding="async">` : "";
    return `<div class="${cls}">${img}<span>${escapeHtml(it.name)}</span></div>`;
  };

  // Duplicamos para loop infinito (marquee)
  track.innerHTML = items.map(pill).join("") + items.map(pill).join("");
}

async function renderMedia({ supabase, kind }) {
  const root = q(`[data-sb='media-${kind}']`);
  if (!root) return;

  const { data, error } = await supabase
    .from("media_items")
    .select("title,description,kind,embed_url,order")
    .eq("kind", kind)
    .order("order", { ascending: true });

  if (error) {
    console.warn("Supabase media error:", kind, error);
    return;
  }

  const items = data || [];
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

async function renderPresskit({ supabase }) {
  // Presskit bio
  const bioRoot = q("[data-sb='presskit-bio']");
  if (bioRoot) {
    const { data, error } = await supabase
      .from("page_blocks")
      .select("key,content")
      .eq("key", "presskit_bio");
    if (!error && data && data[0] && data[0].content) {
      // content puede ser texto con \n\n
      const parts = String(data[0].content).split("\n\n").filter(Boolean);
      bioRoot.innerHTML = parts.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
    }
  }

  // Presskit gallery
  const slides = q("[data-sb='presskit-slides']");
  const dots = q(".slider .slider-dots");
  if (slides) {
    const { data, error } = await supabase
      .from("presskit_assets")
      .select("title,url,order")
      .order("order", { ascending: true });

    if (!error && data && data.length) {
      slides.innerHTML = data
        .map((img, idx) => {
          return `<img src="${escapeHtml(img.url)}" alt="${escapeHtml(img.title || "Manu Pavez")}" class="${idx === 0 ? "active" : ""}" loading="lazy" decoding="async">`;
        })
        .join("");
      if (dots) dots.innerHTML = ""; // slider.js lo rellena
    }
  }

  // Download link (zip/pdf)
  const dl = q("[data-sb='presskit-download']");
  if (dl) {
    const { data, error } = await supabase
      .from("page_blocks")
      .select("key,content")
      .eq("key", "presskit_download_url");
    if (!error && data && data[0] && data[0].content) {
      dl.setAttribute("href", String(data[0].content));
    }
  }
}

async function renderClinics({ supabase }) {
  const root = q("[data-sb='clinics']");
  if (!root) return;

  const { data, error } = await supabase
    .from("clinics")
    .select("title,subtitle,description,bullets,price,cta_label,cta_url,order")
    .order("order", { ascending: true });

  if (error) {
    console.warn("Supabase clinics error:", error);
    return;
  }

  const items = data || [];
  if (!items.length) return;

  root.innerHTML = items
    .map((c) => {
      const bullets = Array.isArray(c.bullets) ? c.bullets : (c.bullets ? String(c.bullets).split("\n") : []);
      return `
        <article class="clinic-card reveal">
          <h3>${escapeHtml(c.title)}</h3>
          ${c.subtitle ? `<p class="muted">${escapeHtml(c.subtitle)}</p>` : ""}
          ${c.description ? `<p>${escapeHtml(c.description)}</p>` : ""}
          ${bullets.length ? `<ul class="clinic-list">${bullets.filter(Boolean).slice(0,10).map((b)=>`<li>${escapeHtml(b)}</li>`).join("")}</ul>` : ""}
          <div class="clinic-actions">
            ${c.price ? `<span class="clinic-price">${escapeHtml(c.price)}</span>` : ""}
            ${c.cta_url ? `<a class="mp-btn primary" href="${escapeHtml(c.cta_url)}" target="_blank" rel="noopener">${escapeHtml(c.cta_label || "Consultar")}</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

async function renderPageBlocks({ supabase }) {
  // Bloques simples por data-sb-block="key"
  const blocks = qa("[data-sb-block]");
  if (!blocks.length) return;

  const keys = Array.from(new Set(blocks.map((b) => b.getAttribute("data-sb-block")).filter(Boolean)));
  if (!keys.length) return;

  const { data, error } = await supabase
    .from("page_blocks")
    .select("key,content")
    .in("key", keys);

  if (error) {
    console.warn("Supabase page_blocks error:", error);
    return;
  }

  const map = new Map((data || []).map((r) => [r.key, r.content]));

  blocks.forEach((node) => {
    const key = node.getAttribute("data-sb-block");
    const content = map.get(key);
    if (content == null) return;

    // Texto simple con \n\n -> <p>
    const parts = String(content).split("\n\n").filter(Boolean);
    node.innerHTML = parts.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  });
}

async function hookBookingForm({ supabase }) {
  const form = document.getElementById("contact-form");
  if (!form) return;

  // Si ya está hookeado, no duplicar
  if (form.dataset.sbBound === "1") return;
  form.dataset.sbBound = "1";

  const note = form.querySelector("#form-note") || (() => {
    const p = document.createElement("p");
    p.id = "form-note";
    p.className = "form-note";
    p.setAttribute("role", "status");
    p.setAttribute("aria-live", "polite");
    form.appendChild(p);
    return p;
  })();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = (form.elements["name"]?.value || "").trim();
    const email = (form.elements["email"]?.value || "").trim();
    const type = (form.elements["type"]?.value || "").trim();
    const message = (form.elements["message"]?.value || "").trim();

    if (!name || !email || !type || !message) {
      note.textContent = "Te falta completar algún campo marcado con *.";
      return;
    }

    // Inserta en Supabase (requiere RLS: anon insert)
    const { error } = await supabase.from("booking_leads").insert([
      { name, email, type, message }
    ]);

    if (error) {
      console.warn("Supabase booking_leads error:", error);
      note.textContent = "No pude enviar por Supabase. Te abro el mail directo como plan B.";
      const subject = "Booking / Contacto - Manu Pavez";
      const body = [
        `Nombre: ${name}`,
        `Email: ${email}`,
        `Tipo de evento: ${type}`,
        "",
        "Mensaje:",
        message,
      ].join("
");
      window.location.href = `mailto:manupavez22@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return;
    }

    note.textContent = "Enviado. Te respondo a la brevedad.";
    form.reset();
  });
}


ready(() => {
  if (!hasSupabaseConfig()) {
    warnMissingConfig();
    return;
  }

  const supabase = initClient();
  if (!supabase) {
    warnMissingConfig();
    return;
  }

  fetchAll({ supabase });
});
