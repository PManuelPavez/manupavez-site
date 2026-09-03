// js/features/cdModal.js
// Reveal inline del release: al clickear la portada, se despliega un panel
// DENTRO de la sección de música (debajo del slider) donde el disco sale del
// artwork y aparecen los links. NO oscurece la web: es parte de la página.
import { prefersReducedMotion } from "../core/motion.js";

let panel, coverImg, titleEl, metaEl, linksEl, activeCard = null;

export function initCdModal() {
  if (panel) return; // una sola vez
  const host = document.querySelector("#musica .section-inner") || document.querySelector("#musica");
  if (!host) return;
  build(host);
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}

function build(host) {
  panel = document.createElement("div");
  panel.className = "release-reveal";
  panel.setAttribute("aria-hidden", "true");
  panel.innerHTML = `
    <div class="release-reveal__inner">
      <div class="release-reveal__content">
        <button class="release-reveal__close" type="button" aria-label="Cerrar">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
        <div class="cd-stage">
          <div class="cd-disc" aria-hidden="true">
            <div class="cd-disc__face"></div>
            <div class="cd-disc__shine"></div>
          </div>
          <div class="cd-case"><img class="cd-cover" alt="" /></div>
        </div>
        <div class="cd-info">
          <h3 class="cd-title"></h3>
          <p class="cd-meta"></p>
          <div class="cd-links"></div>
        </div>
      </div>
    </div>`;
  host.appendChild(panel);

  coverImg = panel.querySelector(".cd-cover");
  titleEl = panel.querySelector(".cd-title");
  metaEl = panel.querySelector(".cd-meta");
  linksEl = panel.querySelector(".cd-links");
  panel.querySelector(".release-reveal__close").addEventListener("click", close);
}

function onDocClick(e) {
  const card = e.target.closest(".track-card");
  if (card && card.closest("[data-sb='releases']")) {
    e.preventDefault(); // no navegamos: revelamos inline
    if (activeCard === card) { close(); return; } // toggle
    openFromCard(card);
    return;
  }
  // click fuera del panel (y fuera de una card) → cerrar
  if (panel.classList.contains("is-open") && !e.target.closest(".release-reveal")) {
    close();
  }
}

function openFromCard(card) {
  const img = card.querySelector(".track-card__cover img");
  const title = card.querySelector(".track-card__title")?.textContent?.trim() || "";
  const meta = card.querySelector(".track-card__meta")?.textContent?.trim() || "";
  const spotify = card.getAttribute("href") || "";

  if (img) {
    coverImg.src = img.currentSrc || img.src;
    coverImg.alt = `Portada — ${title}`;
  }
  titleEl.textContent = title;
  metaEl.textContent = meta;
  buildLinks(spotify);

  if (activeCard) activeCard.classList.remove("is-revealing");
  activeCard = card;
  card.classList.add("is-revealing");

  panel.setAttribute("aria-hidden", "false");
  panel.classList.toggle("cd-no-motion", prefersReducedMotion());

  const wasOpen = panel.classList.contains("is-open");
  if (!wasOpen) {
    void panel.offsetWidth; // reflow → la transición corre desde cerrado
    requestAnimationFrame(() => panel.classList.add("is-open"));
  }

  // traer el reveal a la vista (suave)
  setTimeout(() => {
    if (window.__mpLenis?.scrollTo) window.__mpLenis.scrollTo(panel, { offset: -110 });
    else panel.scrollIntoView({ behavior: "smooth", block: "center" });
  }, wasOpen ? 0 : 240);
}

function buildLinks(spotify) {
  linksEl.innerHTML = "";
  if (spotify) {
    const a = document.createElement("a");
    a.className = "cd-link cd-link--spotify";
    a.href = spotify;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.innerHTML = `
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 10 10A10.012 10.012 0 0 0 12 2Zm4.4 14.6a.75.75 0 0 1-1 .3 8.3 8.3 0 0 0-8.8 0 .75.75 0 0 1-.8-1.3 9.8 9.8 0 0 1 10.4 0 .75.75 0 0 1 .2 1Zm1.3-2.7a.9.9 0 0 1-1.2.3 10.7 10.7 0 0 0-11.4 0 .9.9 0 1 1-.9-1.5 12.3 12.3 0 0 1 13.1 0 .9.9 0 0 1 .4 1.2Zm.2-2.8a1 1 0 0 1-1.3.4 13.4 13.4 0 0 0-13.8 0 1 1 0 0 1-.9-1.7 15.3 15.3 0 0 1 15.6 0 1 1 0 0 1 .4 1.3Z"/></svg>
      <span>Escuchar en Spotify</span>`;
    linksEl.appendChild(a);
  }
  if (!linksEl.childElementCount) {
    const p = document.createElement("p");
    p.className = "cd-link-empty";
    p.textContent = "Próximamente en plataformas.";
    linksEl.appendChild(p);
  }
}

function close() {
  if (!panel || !panel.classList.contains("is-open")) return;
  panel.classList.remove("is-open");
  panel.setAttribute("aria-hidden", "true");
  if (activeCard) activeCard.classList.remove("is-revealing");
  activeCard = null;
}
