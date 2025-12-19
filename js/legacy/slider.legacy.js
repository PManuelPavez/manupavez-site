// js/slider.js
// Sliders: releases (home), media sliders (videos/mixes), presskit fotos.

(() => {
  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function initReleaseSlider() {
    const slider = document.querySelector(".release-slider");
    if (!slider) return;

    const slides = Array.from(slider.querySelectorAll(".release-slide"));
    const prevBtn = slider.querySelector(".release-nav.prev");
    const nextBtn = slider.querySelector(".release-nav.next");

    if (slides.length < 2) {
      // igual marcamos el 1ro activo si existe
      if (slides[0]) slides[0].classList.add("active");
      return;
    }

    let current = Math.max(0, slides.findIndex((s) => s.classList.contains("active")));
    let autoTimer = null;
    const AUTO_DELAY = prefersReducedMotion ? 0 : 9000;

    const showSlide = (index) => {
      slides.forEach((s, i) => s.classList.toggle("active", i === index));
      current = index;
    };

    const goNext = () => showSlide((current + 1) % slides.length);
    const goPrev = () => showSlide((current - 1 + slides.length) % slides.length);

    const stopAuto = () => {
      if (autoTimer) {
        clearInterval(autoTimer);
        autoTimer = null;
      }
    };

    const startAuto = () => {
      stopAuto();
      if (AUTO_DELAY <= 0) return;
      autoTimer = setInterval(goNext, AUTO_DELAY);
    };

    nextBtn?.addEventListener("click", () => {
      goNext();
      startAuto();
    });

    prevBtn?.addEventListener("click", () => {
      goPrev();
      startAuto();
    });

    slider.addEventListener("mouseenter", stopAuto);
    slider.addEventListener("mouseleave", startAuto);

    window.addEventListener("keydown", (e) => {
      if (!document.body.contains(slider)) return;
      if (e.key === "ArrowRight") {
        goNext();
        startAuto();
      } else if (e.key === "ArrowLeft") {
        goPrev();
        startAuto();
      }
    });

    showSlide(current);
    startAuto();
  }

  function initMediaSliders() {
    const sliders = document.querySelectorAll(".media-slider");
    if (!sliders.length) return;

    sliders.forEach((slider) => {
      const track = slider.querySelector(".media-track");
      if (!track) return;

      const prevBtn = slider.querySelector(".media-nav.prev");
      const nextBtn = slider.querySelector(".media-nav.next");
      const slides = Array.from(track.children);
      if (slides.length < 2) return;

      let currentIndex = 0;

      function goTo(index) {
        const maxIndex = slides.length - 1;
        currentIndex = Math.max(0, Math.min(index, maxIndex));
        const offset = -currentIndex * slider.clientWidth;
        track.style.transform = `translateX(${offset}px)`;
        track.style.transition = "transform 0.4s ease";
      }

      prevBtn?.addEventListener("click", () => goTo(currentIndex - 1));
      nextBtn?.addEventListener("click", () => goTo(currentIndex + 1));

      window.addEventListener("resize", () => goTo(currentIndex));
      goTo(0);
    });
  }

  function initPresskitPhotoSlider() {
    const slider = document.querySelector("section.slider");
    if (!slider) return;

    const images = Array.from(slider.querySelectorAll(".slides img"));
    const dotsWrap = slider.querySelector(".slider-dots");
    if (images.length < 2) {
      images[0]?.classList.add("active");
      return;
    }

    let current = Math.max(0, images.findIndex((img) => img.classList.contains("active")));
    let timer = null;
    const DELAY = prefersReducedMotion ? 0 : 5500;

    const show = (i) => {
      const next = (i + images.length) % images.length;
      images[current].classList.remove("active");
      images[next].classList.add("active");

      if (dotsWrap) {
        const dots = dotsWrap.querySelectorAll(".dot");
        dots[current]?.classList.remove("is-active");
        dots[next]?.classList.add("is-active");
      }

      current = next;
    };

    const start = () => {
      if (DELAY <= 0 || timer) return;
      timer = window.setInterval(() => show(current + 1), DELAY);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const restart = () => {
      stop();
      start();
    };

    if (dotsWrap) {
      dotsWrap.innerHTML = "";
      images.forEach((_, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "dot" + (i === current ? " is-active" : "");
        b.addEventListener("click", () => {
          show(i);
          restart();
        });
        dotsWrap.appendChild(b);
      });
    }

    // Pausa si no está visible
    if ("IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (entries) => entries.forEach((e) => (e.isIntersecting ? start() : stop())),
        { threshold: 0.2 }
      );
      io.observe(slider);
    } else {
      start();
    }

    slider.addEventListener("mouseenter", stop);
    slider.addEventListener("mouseleave", start);

    // swipe básico
    let x0 = null;
    slider.addEventListener("pointerdown", (e) => (x0 = e.clientX));
    slider.addEventListener("pointerup", (e) => {
      if (x0 == null) return;
      const dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) < 40) return;
      dx < 0 ? show(current + 1) : show(current - 1);
      restart();
    });

    images.forEach((img, i) => {
      img.classList.toggle("active", i === current);
      img.loading = i === current ? "eager" : "lazy";
      img.decoding = "async";
    });
  }

  // Expone para que app.js pueda reinicializar luego de render dinámico
  window.MP_initReleaseSlider = initReleaseSlider;
  window.MP_initMediaSliders = initMediaSliders;
  window.MP_initPresskitPhotoSlider = initPresskitPhotoSlider;

  document.addEventListener("DOMContentLoaded", () => {
    initReleaseSlider();
    initMediaSliders();
    initPresskitPhotoSlider();
  });
})();
