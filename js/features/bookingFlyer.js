// Home: video opcional del hero + panel desplegable del formulario de booking.

// El <video data-hero-video> queda vacío hasta que se complete data-src.
// data-src admite varios videos separados por coma: arranca por uno al azar
// y al terminar pasa al siguiente con un fundido. Con uno solo, queda en loop.
// Recién cuando puede reproducirse oculta la foto (si falla, queda la foto).
export function initHeroVideo() {
  const video = document.querySelector("[data-hero-video]");
  if (!video) return;

  const isMobile = window.matchMedia("(max-width: 720px)").matches;
  const raw = (isMobile && video.dataset.srcMobile) || video.dataset.src || "";
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const card = video.closest(".hero-card");
  // Si el script de arranque del HTML ya le puso src, seguimos desde ese video.
  const booted = video.getAttribute("src") && Number.isInteger(Number(video.dataset.index));
  let index = booted ? Number(video.dataset.index) : Math.floor(Math.random() * list.length);
  video.loop = list.length === 1;

  const play = () => video.play().catch(() => {});
  const load = (i) => {
    index = (i + list.length) % list.length;
    video.src = list[index];
    video.load();
  };

  const show = () => {
    if (video.hidden) {
      video.hidden = false;
      card?.classList.add("has-video");
    }
    video.classList.remove("is-switching");
    play();
  };
  video.addEventListener("canplay", show);

  video.addEventListener("ended", () => {
    video.classList.add("is-switching");
    setTimeout(() => load(index + 1), 450);
  });

  video.addEventListener("error", () => {
    // Si un archivo falla lo sacamos de la lista; sin videos, queda la foto.
    list.splice(index, 1);
    if (!list.length) {
      card?.classList.remove("has-video");
      video.remove();
      return;
    }
    video.loop = list.length === 1;
    load(index);
  });

  // El navegador pausa los videos en pestañas ocultas: retomamos al volver.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !video.hidden && video.paused) play();
  });

  if (!booted) load(index);
  else if (video.readyState >= 3) show(); // ya estaba listo antes de que cargara este JS
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
