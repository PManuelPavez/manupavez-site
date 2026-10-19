// Home: video opcional del hero + panel desplegable del formulario de booking.

// El <video data-hero-video> queda vacío hasta que se complete data-src.
// Recién cuando puede reproducirse oculta la foto (si falla, queda la foto).
export function initHeroVideo() {
  const video = document.querySelector("[data-hero-video]");
  if (!video) return;

  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  const src = (isMobile && video.dataset.srcMobile) || video.dataset.src;
  if (!src) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const card = video.closest(".hero-card");
  video.addEventListener(
    "canplay",
    () => {
      video.hidden = false;
      card?.classList.add("has-video");
      video.play().catch(() => {});
    },
    { once: true }
  );
  video.addEventListener("error", () => video.remove(), { once: true });
  video.src = src;
  video.load();
}

export function initBookingPanel() {
  const panel = document.querySelector("[data-booking-panel]");
  const openBtn = document.querySelector("[data-booking-open]");
  if (!panel || !openBtn) return;
  const closeBtn = panel.querySelector("[data-booking-close]");

  const open = () => {
    panel.hidden = false;
    openBtn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => panel.classList.add("is-open"));
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
    setTimeout(() => panel.querySelector("input, select, textarea")?.focus({ preventScroll: true }), 450);
  };

  const close = () => {
    panel.classList.remove("is-open");
    openBtn.setAttribute("aria-expanded", "false");
    setTimeout(() => (panel.hidden = true), 300);
    openBtn.focus({ preventScroll: true });
  };

  openBtn.addEventListener("click", () => (panel.hidden ? open() : close()));
  closeBtn?.addEventListener("click", close);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });
}
