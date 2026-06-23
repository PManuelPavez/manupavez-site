// js/features/cdModal.js
// Modal "CD case": al clickear la portada de un release, la tapa gira ~45º
// (se abre), sale un CD hacia arriba, se oscurece el fondo y aparecen los
// links para escuchar. Lee los datos directo del DOM de la card.
import { prefersReducedMotion } from "../core/motion.js";

let modal, coverImg, discEl, titleEl, metaEl, linksEl, dialogEl;
let lastFocused = null;
let closeTimer = null;

export function initCdModal() {
  if (modal) return; // una sola vez
  build();
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal.classList.contains("is-open")) close();
  });
}

function build() {
  modal = document.createElement("div");
  modal.className = "cd-modal";
  modal.setAttribute("hidden", "");
  modal.innerHTML = `
    <div class="cd-modal__backdrop" data-cd-close></div>
    <div class="cd-modal__dialog" role="dialog" aria-modal="true" aria-label="Escuchar release">
      <button class="cd-modal__close" type="button" data-cd-close aria-label="Cerrar">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
      <div class="cd-stage">
        <div class="cd-disc" aria-hidden="true">
          <div class="cd-disc__face"></div>
          <div class="cd-disc__shine"></div>
        </div>
        <div class="cd-case">
          <img class="cd-cover" alt="" />
        </div>
      </div>
      <div class="cd-info">
        <h3 class="cd-title"></h3>
        <p class="cd-meta"></p>
        <div class="cd-links"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  coverImg = modal.querySelector(".cd-cover");
  discEl = modal.querySelector(".cd-disc");
  titleEl = modal.querySelector(".cd-title");
  metaEl = modal.querySelector(".cd-meta");
  linksEl = modal.querySelector(".cd-links");
  dialogEl = modal.querySelector(".cd-modal__dialog");

  modal.querySelectorAll("[data-cd-close]").forEach((el) =>
    el.addEventListener("click", close)
  );
}

function onDocClick(e) {
  const card = e.target.closest(".track-card");
  if (!card || !card.closest("[data-sb='releases']")) return;
  e.preventDefault(); // no navegamos: abrimos el modal
  openFromCard(card);
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

  lastFocused = document.activeElement;
  modal.removeAttribute("hidden");
  clearTimeout(closeTimer);

  // Lock scroll (Lenis + body)
  window.__mpLenis?.stop?.();
  document.body.classList.add("cd-modal-open");

  // forzar reflow para que la transición corra desde el estado cerrado
  void modal.offsetWidth;
  requestAnimationFrame(() => modal.classList.add("is-open"));

  if (prefersReducedMotion()) modal.classList.add("cd-no-motion");
  modal.querySelector(".cd-modal__close")?.focus({ preventScroll: true });
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
  if (!modal.classList.contains("is-open")) return;
  modal.classList.remove("is-open");
  window.__mpLenis?.start?.();
  document.body.classList.remove("cd-modal-open");

  const done = () => {
    modal.setAttribute("hidden", "");
    modal.classList.remove("cd-no-motion");
    if (lastFocused && lastFocused.focus) lastFocused.focus({ preventScroll: true });
  };
  if (prefersReducedMotion()) {
    done();
  } else {
    closeTimer = setTimeout(done, 520);
  }
}
