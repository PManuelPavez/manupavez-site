// js/features/releaseSlider.js
// Slider "Apple-grade" para los releases: drag con momentum/inercia, snap suave
// con easing, parallax interno de la portada, barra de progreso y foco sutil.
// Trabaja sobre el scroll nativo (overflow-x) → conserva trackpad/teclado y
// accesibilidad; le agrega la capa de fluidez por encima.
import { prefersReducedMotion } from "../core/motion.js";

export function enhanceReleaseSlider(row) {
  if (!row || row.dataset.appleSlider === "1") return;
  const carousel = row.closest(".releases-carousel");
  if (!carousel) return;
  row.dataset.appleSlider = "1";

  const reduce = prefersReducedMotion();
  const prev = carousel.querySelector(".release-nav.prev");
  const next = carousel.querySelector(".release-nav.next");
  const progress = carousel.querySelector("[data-slider-progress]");
  const cards = () => Array.from(row.querySelectorAll(".track-card"));

  const clampScroll = (x) => Math.max(0, Math.min(x, row.scrollWidth - row.clientWidth));
  const maxScroll = () => row.scrollWidth - row.clientWidth;

  // ---------- Foco + parallax + progreso (rAF, sólo transform/opacity) ----------
  let ticking = false;
  function paint() {
    ticking = false;
    const rrect = row.getBoundingClientRect();
    const center = rrect.left + rrect.width / 2;

    for (const card of cards()) {
      const crect = card.getBoundingClientRect();
      const cc = crect.left + crect.width / 2;
      // t: -1..1 según distancia al centro del viewport del slider
      const t = Math.max(-1, Math.min(1, (cc - center) / (rrect.width / 2)));
      const abs = Math.abs(t);

      if (reduce) {
        card.style.transform = "";
        card.style.opacity = "";
      } else {
        const scale = 1 - abs * 0.06;
        const op = 1 - abs * 0.28;
        card.style.transform = `scale(${scale.toFixed(4)})`;
        card.style.opacity = op.toFixed(3);
        const img = card.querySelector(".track-card__cover img");
        if (img) img.style.transform = `translate3d(${(-t * 14).toFixed(1)}px,0,0) scale(1.12)`;
      }
    }

    if (progress) {
      const max = maxScroll();
      const p = max > 0 ? Math.max(0, Math.min(1, row.scrollLeft / max)) : 0;
      const ratio = row.scrollWidth > 0 ? Math.min(1, row.clientWidth / row.scrollWidth) : 1;
      const travel = ratio > 0 && ratio < 1 ? ((1 - ratio) / ratio) * 100 : 0;
      progress.style.width = (ratio * 100).toFixed(2) + "%";
      progress.style.transform = `translateX(${(p * travel).toFixed(2)}%)`;
    }
    syncArrows();
  }
  function requestPaint() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(paint);
    }
  }

  function syncArrows() {
    const max = maxScroll() - 1;
    if (prev) prev.disabled = row.scrollLeft <= 0;
    if (next) next.disabled = row.scrollLeft >= max;
  }

  // ---------- Scroll con easing (snap, flechas) ----------
  let animId = null;
  function animateTo(dest, onDone) {
    cancelAnimationFrame(animId);
    dest = clampScroll(dest);
    if (reduce) {
      row.scrollLeft = dest;
      requestPaint();
      onDone && onDone();
      return;
    }
    const start = row.scrollLeft;
    const diff = dest - start;
    if (Math.abs(diff) < 1) {
      animId = null;
      onDone && onDone();
      return;
    }
    const dur = 560;
    let t0 = null;
    const step = (ts) => {
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
      row.scrollLeft = start + diff * e;
      requestPaint();
      if (p < 1) {
        animId = requestAnimationFrame(step);
      } else {
        animId = null;
        onDone && onDone();
      }
    };
    animId = requestAnimationFrame(step);
  }

  const cardCenter = (card) => card.offsetLeft + card.offsetWidth / 2;
  function snapToNearest() {
    if (dragging) return;
    const target = row.scrollLeft + row.clientWidth / 2;
    let best = null;
    let bestD = Infinity;
    for (const card of cards()) {
      const d = Math.abs(cardCenter(card) - target);
      if (d < bestD) {
        bestD = d;
        best = card;
      }
    }
    if (best) animateTo(cardCenter(best) - row.clientWidth / 2);
  }

  // ---------- Snap tras settle del scroll nativo (rueda/trackpad) ----------
  let snapTimer = null;
  function scheduleSnap() {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(snapToNearest, 130);
  }
  row.addEventListener(
    "scroll",
    () => {
      requestPaint();
      if (!dragging && !animId) scheduleSnap();
    },
    { passive: true }
  );

  // ---------- Drag con momentum ----------
  let dragging = false;
  let startX = 0;
  let startScroll = 0;
  let lastX = 0;
  let lastT = 0;
  let vel = 0;

  row.addEventListener("pointerdown", (e) => {
    // En touch/pen dejamos el scroll nativo (mejor momentum en mobile).
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    dragging = true;
    delete row.dataset.dragged;
    row.classList.add("is-dragging");
    cancelAnimationFrame(animId);
    animId = null;
    clearTimeout(snapTimer);
    startX = lastX = e.clientX;
    startScroll = row.scrollLeft;
    lastT = performance.now();
    vel = 0;
    try { row.setPointerCapture(e.pointerId); } catch {}
  });

  row.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) row.dataset.dragged = "1";
    row.scrollLeft = clampScroll(startScroll - dx);
    const now = performance.now();
    const dt = now - lastT;
    if (dt > 0) {
      vel = (e.clientX - lastX) / dt; // px/ms
      lastX = e.clientX;
      lastT = now;
    }
    requestPaint();
  });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    row.classList.remove("is-dragging");
    let v = vel * 16; // px aprox por frame (~60fps)
    if (reduce || Math.abs(v) < 2) {
      snapToNearest();
      return;
    }
    const step = () => {
      row.scrollLeft = clampScroll(row.scrollLeft - v);
      v *= 0.94; // fricción
      requestPaint();
      const atEdge = row.scrollLeft <= 0 || row.scrollLeft >= maxScroll();
      if (Math.abs(v) > 0.5 && !atEdge) {
        animId = requestAnimationFrame(step);
      } else {
        animId = null;
        snapToNearest();
      }
    };
    animId = requestAnimationFrame(step);
  }
  row.addEventListener("pointerup", endDrag);
  row.addEventListener("pointercancel", endDrag);

  // Evitar que un drag dispare el link de la card
  row.addEventListener(
    "click",
    (e) => {
      if (row.dataset.dragged) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // ---------- Flechas + teclado ----------
  function stepBy(dir) {
    const cs = cards();
    if (!cs.length) return;
    animateTo(row.scrollLeft + dir * row.clientWidth * 0.85, snapToNearest);
  }
  prev?.addEventListener("click", () => stepBy(-1));
  next?.addEventListener("click", () => stepBy(1));
  row.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); stepBy(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); stepBy(-1); }
  });

  // ---------- Barra de progreso draggable ----------
  const track = progress?.parentElement;
  if (track) {
    track.addEventListener("pointerdown", (e) => {
      const r = track.getBoundingClientRect();
      const p = (e.clientX - r.left) / r.width;
      animateTo(p * maxScroll());
    });
  }

  window.addEventListener("resize", requestPaint);
  // Paint inicial (y un reintento por si las portadas cambian de tamaño al cargar)
  requestPaint();
  setTimeout(requestPaint, 400);
  setTimeout(requestPaint, 1500);
}
