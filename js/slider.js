// js/slider.js
document.addEventListener("DOMContentLoaded", () => {
  const slider = document.querySelector(".release-slider");
  if (!slider) return;

  const slides = Array.from(slider.querySelectorAll(".release-slide"));
  const prevBtn = slider.querySelector(".release-nav.prev");
  const nextBtn = slider.querySelector(".release-nav.next");

  if (!slides.length) return;

  let current = 0;
  let autoTimer = null;
  const AUTO_DELAY = 9000; // 9s

  const showSlide = (index) => {
    slides.forEach((s, i) => {
      s.classList.toggle("active", i === index);
    });
    current = index;
  };

  const goNext = () => {
    const next = (current + 1) % slides.length;
    showSlide(next);
  };

  const goPrev = () => {
    const prev = (current - 1 + slides.length) % slides.length;
    showSlide(prev);
  };

  const startAuto = () => {
    stopAuto();
    autoTimer = setInterval(goNext, AUTO_DELAY);
  };

  const stopAuto = () => {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  };

  // eventos
  nextBtn?.addEventListener("click", () => {
    goNext();
    startAuto();
  });

  prevBtn?.addEventListener("click", () => {
    goPrev();
    startAuto();
  });

  // teclado (desktop)
  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      goNext();
      startAuto();
    } else if (e.key === "ArrowLeft") {
      goPrev();
      startAuto();
    }
  });

  // pausa al pasar el mouse por arriba (desktop)
  slider.addEventListener("mouseenter", stopAuto);
  slider.addEventListener("mouseleave", startAuto);

  // arranque
  showSlide(0);
  startAuto();
});
