import { $, $$ } from "../core/dom.js";
import { prefersReducedMotion } from "../core/motion.js";

export function initSliders() {
  initReleaseSlider();
  initMediaSliders();
  initPresskitPhotoSlider();
}

// --- Releases (Home)
export function initReleaseSlider() {
  const slider = $("[data-slider='release']") || $(".release-slider");
  if (!slider) return;

  // Modo marquee infinito (se activa desde pages/home.js)
  if (slider.getAttribute("data-marquee") === "true") return;

  const slides = Array.from(slider.querySelectorAll(".release-slide"));
  const prevBtn = $("[data-slider-prev]", slider) || slider.querySelector(".release-nav.prev");
  const nextBtn = $("[data-slider-next]", slider) || slider.querySelector(".release-nav.next");

  if (slides.length < 2) {
    slides[0]?.classList.add("active");
    return;
  }

  let current = Math.max(0, slides.findIndex((s) => s.classList.contains("active")));
  let autoTimer = null;
  const AUTO_DELAY = prefersReducedMotion() ? 0 : 9000;

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

  nextBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    goNext();
    startAuto();
  });

  prevBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    goPrev();
    startAuto();
  });

  slider.addEventListener("mouseenter", stopAuto);
  slider.addEventListener("mouseleave", startAuto);

  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
      startAuto();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
      startAuto();
    }
  });

  showSlide(current);
  startAuto();
}

// --- Media sliders (Video + Mixes)
export function initMediaSliders() {
  const sliders = $$("[data-slider='media']")
    .concat($$(".media-slider"))
    .filter((el, idx, arr) => arr.indexOf(el) === idx);

  if (!sliders.length) return;

  sliders.forEach((slider) => {
    const track = $("[data-slider-track]", slider) || slider.querySelector(".media-track");
    if (!track) return;

    const prevBtn = $("[data-slider-prev]", slider) || slider.querySelector(".media-nav.prev");
    const nextBtn = $("[data-slider-next]", slider) || slider.querySelector(".media-nav.next");

    const slides = Array.from(track.children);
    if (slides.length < 2) return;

    let currentIndex = 0;

    function goTo(index) {
      const maxIndex = slides.length - 1;
      currentIndex = Math.max(0, Math.min(index, maxIndex));
      const offset = -currentIndex * slider.clientWidth;
      track.style.transform = `translateX(${offset}px)`;
    }

    prevBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      goTo(currentIndex - 1);
    });

    nextBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      goTo(currentIndex + 1);
    });

    slider.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        goTo(currentIndex + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        goTo(currentIndex - 1);
      }
    });

    window.addEventListener("resize", () => goTo(currentIndex));
    goTo(0);
  });
}

// --- Presskit photo slider (fade)
export function initPresskitPhotoSlider() {
  const slider = $("[data-slider='presskit']") || document.querySelector("section.slider");
  if (!slider) return;

  const images = Array.from(slider.querySelectorAll(".slides img"));
  const dotsWrap = slider.querySelector(".slider-dots");
  if (images.length < 2) {
    images[0]?.classList.add("active");
    return;
  }

  let current = Math.max(0, images.findIndex((img) => img.classList.contains("active")));
  let timer = null;
  const autoplayMsAttr = parseInt(slider.getAttribute("data-autoplay") || "", 10);
  const DELAY = prefersReducedMotion() ? 0 : (Number.isFinite(autoplayMsAttr) ? autoplayMsAttr : 5500);

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
      b.setAttribute("aria-label", `Ver foto ${i + 1}`);
      b.addEventListener("click", () => {
        show(i);
        restart();
      });
      dotsWrap.appendChild(b);
    });
  }

  // Pause if not visible
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

  // Swipe
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
