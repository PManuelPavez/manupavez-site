import { $, $$ } from "../core/dom.js";
import { prefersReducedMotion } from "../core/motion.js";

export function initSliders() {
  initReleaseSlider();
  initMediaSliders();
  initPresskitPhotoSlider();
}

// --- Releases (Home) — autoplay + loop en el SCROLLER correcto
export function initReleaseSlider() {
  const slider = $("[data-slider='release']") || $(".release-slider");
  if (!slider) return;

  // LIST: donde se renderizan las cards reales
  const list = slider.querySelector("[data-sb='releases']") || slider.querySelector(".release-track");
  if (!list) return;

  // SCROLLER: el que realmente debería moverse (wrapper)
  const scroller =
    $("[data-slider-track]", slider) ||
    slider.querySelector(".release-slides") ||
    list;

  const prevBtn = $("[data-slider-prev]", slider) || slider.querySelector(".release-nav.prev");
  const nextBtn = $("[data-slider-next]", slider) || slider.querySelector(".release-nav.next");

  const items = () =>
    Array.from(list.children).filter(
      (el) => el && el.nodeType === 1 && el.getAttribute("data-clone") !== "1"
    );

  const initialCount = items().length;

  // Si todavía no hay contenido (Supabase renderiza después), esperamos y reintentamos
  if (initialCount === 0) {
    if (slider.dataset.waiting === "1") return;
    slider.dataset.waiting = "1";

    const mo = new MutationObserver(() => {
      if (items().length > 0) {
        mo.disconnect();
        slider.dataset.waiting = "0";
        slider.dataset.bound = "0"; // permitir bind real al reintentar
        initReleaseSlider();
      }
    });

    mo.observe(list, { childList: true });
    return;
  }

  // Si hay 1 solo item, deshabilitamos y salimos
  if (initialCount === 1) {
    prevBtn && (prevBtn.disabled = true);
    nextBtn && (nextBtn.disabled = true);
    return;
  }

  // Evitar doble binding
  if (slider.dataset.bound === "1") return;
  slider.dataset.bound = "1";

  let autoTimer = null;

  // Respeta reduced motion (autoplay OFF si reduce)
  const AUTO_DELAY = prefersReducedMotion() ? 0 : 4800;

  const getStep = () => {
    const els = items();
    if (els.length < 2) return Math.max(240, slider.clientWidth * 0.65);
    const a = els[0].getBoundingClientRect();
    const b = els[1].getBoundingClientRect();
    const gap = Math.max(0, Math.round(b.left - a.right));
    const step = Math.round(a.width + gap);
    return step > 0 ? step : Math.max(240, slider.clientWidth * 0.65);
  };

  const setupLoop = () => {
    if (list.dataset.looped === "1") return;

    const els = items();
    if (els.length < 2) return;

    // Con pocos items (ej: 3), clonamos sets completos para que el loop sea real
    const base = els.slice();

    const cloneBlock = (node) => {
      const c = node.cloneNode(true);
      c.setAttribute("data-clone", "1");
      c.setAttribute("aria-hidden", "true");
      c.querySelectorAll?.("a,button,input,select,textarea,[tabindex]")?.forEach?.((n) => {
        try { n.setAttribute("tabindex", "-1"); } catch {}
      });
      return c;
    };

    // Prepend 1 set completo (reverso)
    base.slice().reverse().forEach((el) => {
      list.insertBefore(cloneBlock(el), list.firstChild);
    });

    // Append 1 set completo
    base.forEach((el) => {
      list.appendChild(cloneBlock(el));
    });

    // Si todavía queda corto visualmente, agregamos sets extra al final (máximo 4)
    let safety = 0;
    while (scroller.scrollWidth < slider.clientWidth * 2.2 && safety < 4) {
      base.forEach((el) => list.appendChild(cloneBlock(el)));
      safety++;
    }

    list.dataset.looped = "1";

    // Jump al primer item real (después de 1 set prepended)
    requestAnimationFrame(() => {
      const step = getStep();
      scroller.scrollLeft = step * base.length;
    });

    // Wrap infinito (sobre el scroller real)
    const onScroll = () => {
      const step = getStep();
      const totalReal = base.length;

      const startReal = step * totalReal;
      const endReal = startReal + step * totalReal;

      if (scroller.scrollLeft <= startReal - step * 0.6) {
        scroller.scrollLeft += step * totalReal;
      } else if (scroller.scrollLeft >= endReal + step * 0.6) {
        scroller.scrollLeft -= step * totalReal;
      }
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });

    window.addEventListener("resize", () => {
      const step = getStep();
      scroller.scrollLeft = step * base.length;
    }, { passive: true });
  };

  const goBy = (dir) => {
    const step = getStep();
    scroller.scrollBy({
      left: dir * step,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  // ✅ Autoplay robusto: solo avanza cuando hay overflow real
  const hasOverflow = () => scroller.scrollWidth > scroller.clientWidth + 4;

  const stopAuto = () => {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  };

  const tick = () => {
    // Si el CSS aún no armó overflow horizontal, no hay “movimiento visible”
    if (!hasOverflow()) return;
    goBy(1);
  };

  const startAuto = () => {
    stopAuto();
    if (AUTO_DELAY <= 0) return; // respeta reduced motion
    autoTimer = setInterval(tick, AUTO_DELAY);
  };

  const ensureOverflowThenStart = () => {
    if (AUTO_DELAY <= 0) return;
    if (hasOverflow()) {
      startAuto();
      return;
    }
    // Espera hasta que el layout cree overflow (CSS)
    let tries = 0;
    const maxTries = 180; // ~3s aprox
    const rafCheck = () => {
      tries++;
      if (hasOverflow()) {
        startAuto();
        return;
      }
      if (tries < maxTries) requestAnimationFrame(rafCheck);
    };
    requestAnimationFrame(rafCheck);
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

  // Se mueve siempre: pausamos solo si el usuario interactúa de verdad
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

  requestAnimationFrame(() => {
    setupLoop();
    ensureOverflowThenStart(); // ✅ antes era startAuto()
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
