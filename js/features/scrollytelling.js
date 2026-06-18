import { $, $$ } from "../core/dom.js";
import { prefersReducedMotion } from "../core/motion.js";

/**
 * Capa de Scrollytelling (smooth scroll + parallax + fade-up).
 *
 * Estrategia: realza la experiencia SIN romper nada.
 * - Si Lenis/GSAP no cargaron (CDN caído) o el usuario pide menos movimiento,
 *   esta función sale temprano y el sistema original de `.reveal`
 *   (IntersectionObserver en reveal.js) sigue funcionando como fallback.
 * - Cuando GSAP está activo, marcamos <html class="gsap-ready"> y el CSS
 *   le cede el control de la animación de `.reveal` a GSAP.
 */
export function initScrollytelling() {
  const { gsap, ScrollTrigger, Lenis } = window;

  // Fallback elegante: sin GSAP no tocamos nada; manda el IO de reveal.js
  if (!gsap || !ScrollTrigger) return;

  // Respetar accesibilidad: dejamos el sistema original (que ya hace todo visible)
  if (prefersReducedMotion()) return;

  gsap.registerPlugin(ScrollTrigger);

  // A partir de acá, GSAP es dueño del reveal/parallax (ver scrollytelling.css)
  document.documentElement.classList.add("gsap-ready");

  /* ---------------------------------------------------------------
     1) LENIS — Smooth scrolling en toda la página
     --------------------------------------------------------------- */
  if (Lenis) {
    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), // easeOutExpo
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    });

    // Mantener ScrollTrigger sincronizado con la posición de Lenis
    lenis.on("scroll", ScrollTrigger.update);

    // Usar el ticker de GSAP como loop de animación (sin doble RAF)
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);

    // Que los anchors internos (#musica, #booking…) usen el scroll suave
    $$('a[href^="#"]').forEach((a) => {
      const id = a.getAttribute("href");
      if (!id || id === "#") return;
      a.addEventListener("click", (e) => {
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: 0 });
      });
    });

    window.__mpLenis = lenis; // expuesto por si hace falta desde otros módulos
  }

  /* ---------------------------------------------------------------
     2) PARALLAX — Hero: el fondo se mueve más lento que el scroll
     Importante: animamos `.hero-bg` (contenedor), NO `.hero-img`,
     porque la imagen lleva su propio transform de encuadre (--photo-x/zoom).
     --------------------------------------------------------------- */
  // La foto dentro de la tarjeta del hero se mueve y escala apenas con el
  // scroll: da profundidad sin despegar el encuadre.
  const heroImg = $(".hero-card-img");
  const hero = $(".hero");
  if (heroImg && hero) {
    gsap.fromTo(
      heroImg,
      { yPercent: -5, scale: 1.08 },
      {
        yPercent: 8,
        scale: 1.14,
        ease: "none",
        scrollTrigger: {
          trigger: hero,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      }
    );
  }

  // Parallax sutil para el strip de fotos (profundidad extra)
  const strip = $(".photo-strip-track");
  if (strip) {
    gsap.fromTo(
      strip,
      { yPercent: -4 },
      {
        yPercent: 4,
        ease: "none",
        scrollTrigger: {
          trigger: ".photo-strip",
          start: "top bottom",
          end: "bottom top",
          scrub: true,
        },
      }
    );
  }

  /* ---------------------------------------------------------------
     3) FADE-UP — Bloques importantes emergen al entrar al viewport
     Reutilizamos los `.reveal` existentes (música, sellos, fechas, bio,
     booking…) y cualquier `[data-fade-up]` opcional.
     --------------------------------------------------------------- */
  const blocks = [...$$(".reveal"), ...$$("[data-fade-up]")].filter(
    (el, i, arr) => arr.indexOf(el) === i
  );

  blocks.forEach((el) => {
    gsap.fromTo(
      el,
      { autoAlpha: 0, y: 48 },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.9,
        ease: "power2.out",
        scrollTrigger: {
          trigger: el,
          start: "top 85%",
          toggleActions: "play none none none",
        },
        onComplete: () => el.classList.add("is-visible"),
      }
    );
  });

  /* ---------------------------------------------------------------
     Recalcular posiciones cuando entra contenido dinámico (Supabase),
     se cargan fuentes/imágenes o cambia el tamaño de la ventana.
     --------------------------------------------------------------- */
  window.addEventListener("load", () => ScrollTrigger.refresh());
  // Releases/videos/mixes se renderizan async tras la config de Supabase
  setTimeout(() => ScrollTrigger.refresh(), 1500);
  setTimeout(() => ScrollTrigger.refresh(), 4000);
}

/**
 * Cascada (stagger) de aparición para un grupo de elementos que se renderizan
 * de forma asíncrona (cards de releases, items de live sets…).
 * Si no hay GSAP o el usuario pide menos movimiento, los deja visibles.
 */
export function staggerReveal(elements, opts = {}) {
  const els = Array.from(elements || []).filter(Boolean);
  if (!els.length) return;

  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger || prefersReducedMotion()) {
    els.forEach((el) => {
      el.style.opacity = "";
      el.style.transform = "";
      el.style.visibility = "";
    });
    return;
  }

  gsap.fromTo(
    els,
    { autoAlpha: 0, y: opts.y ?? 26 },
    {
      autoAlpha: 1,
      y: 0,
      duration: opts.duration ?? 0.7,
      ease: "power3.out",
      stagger: opts.stagger ?? 0.07,
      scrollTrigger: {
        trigger: opts.trigger || els[0],
        start: opts.start || "top 88%",
        toggleActions: "play none none none",
      },
    }
  );

  ScrollTrigger.refresh();
}
