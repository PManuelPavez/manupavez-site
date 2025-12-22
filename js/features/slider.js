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

  const track = slider.querySelector("[data-sb='releases']") || slider.querySelector(".release-track");
  const prevBtn = $("[data-slider-prev]", slider) || slider.querySelector(".release-nav.prev");
  const nextBtn = $("[data-slider-next]", slider) || slider.querySelector(".release-nav.next");
  if (!track) return;

  const items = () => Array.from(track.children).filter((el) => el && el.nodeType === 1);
  const initialCount = items().length;
  // Si todavía no hay contenido (Supabase), no bindeamos ni deshabilitamos (se re-intenta luego).
  if (initialCount === 0) return;
  // Si hay 1 solo item, deshabilitamos.
  if (initialCount === 1) {
    prevBtn && (prevBtn.disabled = true);
    nextBtn && (nextBtn.disabled = true);
    return;
  }

  // Evitar doble binding (pero dejamos que el loop se regenere si cambió el contenido)
  if (slider.dataset.bound === "1") return;
  slider.dataset.bound = "1";

  let autoTimer = null;
  const AUTO_DELAY = prefersReducedMotion() ? 0 : 4800;

  const getStep = () => {
    const els = items();
    if (els.length < 2) return Math.max(240, slider.clientWidth * 0.65);
    const a = els[0].getBoundingClientRect();
    const b = els[1].getBoundingClientRect();
    const gap = Math.max(0, Math.round(b.left - a.right));
    return Math.round(a.width + gap);
  };

  const setupLoop = () => {
    if (track.dataset.looped === "1") return;
    const els = items();
    if (els.length < 3) return;

    const cloneCount = Math.min(4, els.length);
    const head = els.slice(0, cloneCount);
    const tail = els.slice(-cloneCount);

    // Prepend tail clones
    tail.forEach((el) => {
      const c = el.cloneNode(true);
      c.setAttribute("data-clone", "1");
      c.setAttribute("aria-hidden", "true");
      // clones no deben ser focusables
      c.tabIndex = -1;
      c.querySelectorAll?.("a,button,[tabindex]")?.forEach?.((n) => {
        try { n.setAttribute("tabindex", "-1"); } catch {}
      });
      track.insertBefore(c, track.firstChild);
    });
    // Append head clones
    head.forEach((el) => {
      const c = el.cloneNode(true);
      c.setAttribute("data-clone", "1");
      c.setAttribute("aria-hidden", "true");
      c.tabIndex = -1;
      c.querySelectorAll?.("a,button,[tabindex]")?.forEach?.((n) => {
        try { n.setAttribute("tabindex", "-1"); } catch {}
      });
      track.appendChild(c);
    });

    track.dataset.looped = "1";

    // Jump to first real item (after the prepended clones)
    requestAnimationFrame(() => {
      const step = getStep();
      track.scrollLeft = step * cloneCount;
    });

    // Keep loop illusion on scroll
    const onScroll = () => {
      const step = getStep();
      const totalReal = els.length;
      const cloneW = step * cloneCount;
      const startReal = cloneW;
      const endReal = cloneW + step * totalReal;

      // If we reach the cloned regions, reset without animation
      if (track.scrollLeft <= startReal - step * 0.6) {
        track.scrollLeft += step * totalReal;
      } else if (track.scrollLeft >= endReal + step * 0.6) {
        track.scrollLeft -= step * totalReal;
      }
    };

    track.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", () => {
      const step = getStep();
      track.scrollLeft = step * cloneCount;
    }, { passive: true });
  };

  const goBy = (dir) => {
    const step = getStep();
    track.scrollBy({ left: dir * step, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };

  const stopAuto = () => {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  };
  const startAuto = () => {
    stopAuto();
    if (AUTO_DELAY <= 0) return;
    autoTimer = setInterval(() => goBy(1), AUTO_DELAY);
  };

  prevBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    goBy(-1);
    startAuto();
  });

  nextBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    goBy(1);
    startAuto();
  });

  // Que se mueva siempre: pausamos solo si el usuario interactúa (drag/click) o focus.
  slider.addEventListener("pointerdown", stopAuto);
  slider.addEventListener("pointerup", startAuto);
  slider.addEventListener("pointercancel", startAuto);
  slider.addEventListener("focusin", stopAuto);
  slider.addEventListener("focusout", startAuto);

  slider.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goBy(1);
      startAuto();
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goBy(-1);
      startAuto();
    }
  });

  // Inicialización diferida (por si Supabase renderiza un toque después)
  requestAnimationFrame(() => {
    setupLoop();
    startAuto();
  });
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
