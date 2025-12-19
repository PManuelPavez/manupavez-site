// js/main.js (limpio)
(() => {
  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  document.addEventListener("DOMContentLoaded", () => {
    initMobileNav();
    initHeaderAndHero();
    initReveal();
    initHeadingAnimations();
    initActiveNav();
    initScrollTop();
    initContactForm();
    initHeroPointerGlow();
  });

  function initMobileNav() {
    const toggle = document.querySelector(".menu-toggle");
    const nav = document.getElementById("mobile-nav");
    if (!toggle || !nav) return;

    const open = () => {
      nav.removeAttribute("hidden");
      toggle.setAttribute("aria-expanded", "true");
      document.body.classList.add("mobile-nav-open");
    };

    const close = () => {
      nav.setAttribute("hidden", "");
      toggle.setAttribute("aria-expanded", "false");
      document.body.classList.remove("mobile-nav-open");
    };

    const isOpen = () => !nav.hasAttribute("hidden");
    close();

    toggle.addEventListener("click", (e) => {
      e.preventDefault();
      isOpen() ? close() : open();
    });

    nav.addEventListener("click", (e) => {
      if (e.target && e.target.tagName === "A") close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) close();
    });

    document.addEventListener("click", (e) => {
      if (!isOpen()) return;
      if (!nav.contains(e.target) && !toggle.contains(e.target)) close();
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 860 && isOpen()) close();
    });
  }

  function initHeaderAndHero() {
    const header = document.querySelector(".site-header");
    const heroVideo = document.querySelector(".hero-video");
    if (!header && !heroVideo) return;

    let lastY = 0;
    let ticking = false;

    const update = () => {
      const y = lastY;
      if (header) header.classList.toggle("scrolled", y > 20);
      if (heroVideo && !prefersReducedMotion) {
        const shift = Math.min(40, y * 0.12);
        heroVideo.style.transform = `translateY(${shift}px)`;
      }
      ticking = false;
    };

    const onScroll = () => {
      lastY = window.scrollY || 0;
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function initReveal() {
    const revealEls = document.querySelectorAll(".reveal");
    const footerInner = document.querySelector(".footer-inner");
    if (!revealEls.length && !footerInner) return;

    const show = (el) => el && el.classList.add("is-visible");

    if (!("IntersectionObserver" in window)) {
      revealEls.forEach(show);
      show(footerInner);
      return;
    }

    const obs = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            show(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    revealEls.forEach((el) => obs.observe(el));
    if (footerInner) obs.observe(footerInner);
  }

  function initHeadingAnimations() {
    const headings = document.querySelectorAll('[data-animate="heading"]');
    if (!headings.length) return;

    const show = (h) => h.classList.add("is-animated");

    if (!("IntersectionObserver" in window)) {
      headings.forEach(show);
      return;
    }

    const obs = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            show(entry.target);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.4 }
    );

    headings.forEach((h) => obs.observe(h));
  }

  function initActiveNav() {
    const navLinks = Array.from(document.querySelectorAll('.nav a[href^="#"]'));
    if (!navLinks.length) return;

    const sections = navLinks
      .map((link) => {
        const id = link.getAttribute("href");
        const el = id ? document.querySelector(id) : null;
        return el ? { id, el } : null;
      })
      .filter(Boolean);

    if (!sections.length) return;

    let lastY = 0;
    let ticking = false;

    const update = () => {
      const y = lastY;
      const offset = 140;
      let currentId = null;
      for (const s of sections) {
        if (y >= s.el.offsetTop - offset) currentId = s.id;
      }
      navLinks.forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === currentId);
      });
      ticking = false;
    };

    const onScroll = () => {
      lastY = window.scrollY || 0;
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  function initScrollTop() {
    const btn = document.querySelector(".scroll-top");
    if (!btn) return;

    const onScroll = () => {
      btn.classList.toggle("visible", (window.scrollY || 0) > 400);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function initContactForm() {
    // Si Supabase está configurado, el submit lo maneja js/app.js
    const cfg = window.MP_SUPABASE || {};
    if (cfg.url && cfg.anonKey && !String(cfg.url).includes('YOUR_')) return;

    const form = document.getElementById("contact-form");
    if (!form) return;

    const note = ensureFormNote(form);

    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const name = (form.elements["name"]?.value || "").trim();
      const email = (form.elements["email"]?.value || "").trim();
      const type = (form.elements["type"]?.value || "").trim();
      const message = (form.elements["message"]?.value || "").trim();

      if (!name || !email || !type || !message) {
        note.textContent = "Te falta completar algún campo marcado con *.";
        return;
      }

      note.textContent = "";
      const subject = "Booking / Contacto - Manu Pavez";
      const body = [
        `Nombre: ${name}`,
        `Email: ${email}`,
        `Tipo de solicitud: ${type}`,
        "",
        "Mensaje:",
        message,
      ].join("\n");

      window.location.href =
        `mailto:manupavez22@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });

    function ensureFormNote(formEl) {
      let el = formEl.querySelector("#form-note");
      if (el) return el;
      el = document.createElement("p");
      el.id = "form-note";
      el.className = "form-note";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      formEl.appendChild(el);
      return el;
    }
  }

  function initHeroPointerGlow() {
    const hero = document.querySelector(".hero");
    if (!hero) return;

    const finePointer =
      window.matchMedia && window.matchMedia("(pointer: fine)").matches;
    if (!finePointer) return;

    hero.addEventListener("pointermove", (e) => {
      const r = hero.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * 100;
      const y = ((e.clientY - r.top) / r.height) * 100;
      hero.style.setProperty("--mx", `${x.toFixed(2)}%`);
      hero.style.setProperty("--my", `${y.toFixed(2)}%`);
    });
  }
})();
