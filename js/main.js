document.addEventListener('DOMContentLoaded', function () {
  /* =========================
     MENÚ MÓVIL
     ========================== */
  var menuToggle = document.querySelector('.menu-toggle');
  var mobileNav = document.getElementById('mobile-nav');

  function isMobileNavOpen() {
    if (!mobileNav) return false;
    return !mobileNav.hasAttribute('hidden');
  }

  function openMobileNav() {
    if (!mobileNav || !menuToggle) return;
    mobileNav.removeAttribute('hidden');
    menuToggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('mobile-nav-open');
  }

  function closeMobileNav() {
    if (!mobileNav || !menuToggle) return;
    if (!mobileNav.hasAttribute('hidden')) {
      mobileNav.setAttribute('hidden', '');
    }
    menuToggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('mobile-nav-open');
  }

  // Siempre arrancamos con el menú cerrado
  closeMobileNav();

  if (menuToggle && mobileNav) {
    // Abrir / cerrar con el botón hamburguesa
    menuToggle.addEventListener('click', function () {
      if (isMobileNavOpen()) {
        closeMobileNav();
      } else {
        openMobileNav();
      }
    });

    // Cerrar al hacer click en un link del menú móvil
    mobileNav.addEventListener('click', function (e) {
      if (e.target && e.target.tagName === 'A') {
        closeMobileNav();
      }
    });

    // Cerrar al hacer click fuera del menú y del botón
    document.addEventListener('click', function (e) {
      if (!isMobileNavOpen()) return;
      var clickedInsideNav = mobileNav.contains(e.target);
      var clickedToggle = menuToggle.contains(e.target);
      if (!clickedInsideNav && !clickedToggle) {
        closeMobileNav();
      }
    });

    // Cerrar al hacer scroll
    window.addEventListener(
      'scroll',
      function () {
        if (isMobileNavOpen()) {
          closeMobileNav();
        }
      },
      { passive: true }
    );

    // Cerrar al cambiar de tamaño (ej: girar el celu o pasar a desktop)
    window.addEventListener('resize', function () {
      if (window.innerWidth > 860 && isMobileNavOpen()) {
        closeMobileNav();
      }
    });
  }

  /* =========================
     HORA LOCAL
     ========================== */
  var localTimeEl = document.getElementById('local-time');

  function updateLocalTime() {
    if (!localTimeEl) return;
    var now = new Date();
    var opts = { hour: '2-digit', minute: '2-digit' };
    localTimeEl.textContent = now.toLocaleTimeString('es-AR', opts);
  }

  updateLocalTime();
  setInterval(updateLocalTime, 60000);

  /* =========================
     HEADER SCROLL + HERO PARALLAX
     ========================== */
  var header = document.querySelector('.site-header');
  var heroVideo = document.querySelector('.hero-video');

  function onScroll() {
    var y = window.scrollY || window.pageYOffset || 0;

    if (header) {
      if (y > 20) {
        header.classList.add('scrolled');
      } else {
        header.classList.remove('scrolled');
      }
    }

    if (heroVideo) {
      var maxShift = 40;
      var shift = y * 0.12;
      if (shift > maxShift) shift = maxShift;
      heroVideo.style.transform = 'translateY(' + shift + 'px)';
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* =========================
     REVEAL EN SCROLL
     ========================== */
  var revealEls = document.querySelectorAll('.reveal');
  var footerInner = document.querySelector('.footer-inner');

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );

    for (var i = 0; i < revealEls.length; i++) {
      observer.observe(revealEls[i]);
    }
    if (footerInner) observer.observe(footerInner);
  } else {
    for (var j = 0; j < revealEls.length; j++) {
      revealEls[j].classList.add('is-visible');
    }
    if (footerInner) footerInner.classList.add('is-visible');
  }

  /* =========================
     NAV ACTIVO SEGÚN SECCIÓN
     ========================== */
  var navLinks = document.querySelectorAll('.nav a[href^="#"]');
  var sections = [];

  navLinks.forEach(function (link) {
    var id = link.getAttribute('href');
    if (!id || id === '#') return;
    var el = document.querySelector(id);
    if (el) {
      sections.push({ id: id, el: el });
    }
  });

  function markActiveSection() {
    var y = window.scrollY || window.pageYOffset || 0;
    var offset = 140;
    var currentId = null;

    sections.forEach(function (section) {
      var top = section.el.offsetTop - offset;
      if (y >= top) {
        currentId = section.id;
      }
    });

    navLinks.forEach(function (link) {
      var href = link.getAttribute('href');
      if (!href) return;
      if (href === currentId) {
        link.classList.add('is-active');
      } else {
        link.classList.remove('is-active');
      }
    });
  }

  window.addEventListener('scroll', markActiveSection, { passive: true });
  markActiveSection();

  /* =========================
     FORMULARIO DE CONTACTO
     ========================== */
  var contactForm = document.getElementById('contact-form');

  if (contactForm) {
    contactForm.addEventListener('submit', function (e) {
      e.preventDefault();

      var nameField = contactForm.elements['name'];
      var emailField = contactForm.elements['email'];
      var typeField = contactForm.elements['type'];
      var messageField = contactForm.elements['message'];

      var name = nameField ? nameField.value.trim() : '';
      var email = emailField ? emailField.value.trim() : '';
      var type = typeField ? typeField.value : '';
      var message = messageField ? messageField.value.trim() : '';

      if (!name || !email || !type || !message) {
        return;
      }

      var subject = encodeURIComponent('Manu Pavez - Contacto/Booking');
      var body = encodeURIComponent(
        'Nombre: ' + name + '\n' +
        'Correo: ' + email + '\n' +
        'Tipo de evento: ' + type + '\n\n' +
        'Mensaje:\n' + message
      );

      window.location.href =
        'mailto:manupavez22@gmail.com?subject=' + subject + '&body=' + body;
    });
  }
});
// =========== SLIDERS DE MEDIA (VIDEOS / MIXES) ===========
function initMediaSliders() {
  const sliders = document.querySelectorAll('.media-slider');

  sliders.forEach(slider => {
    const track = slider.querySelector('.media-track');
    if (!track) return;

    const prevBtn = slider.querySelector('.media-nav.prev');
    const nextBtn = slider.querySelector('.media-nav.next');

    let currentIndex = 0;

    const slides = Array.from(track.children);

    function goTo(index) {
      if (!slides.length) return;
      const maxIndex = slides.length - 1;
      currentIndex = Math.max(0, Math.min(index, maxIndex));
      const offset = -currentIndex * slider.clientWidth;
      track.style.transform = `translateX(${offset}px)`;
      track.style.transition = 'transform 0.4s ease';
    }

    prevBtn?.addEventListener('click', () => {
      goTo(currentIndex - 1);
    });

    nextBtn?.addEventListener('click', () => {
      goTo(currentIndex + 1);
    });

    // reset on resize para evitar desajustes
    window.addEventListener('resize', () => {
      goTo(currentIndex);
    });

    // inicio
    goTo(0);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  // ...lo que ya tenías...
  initMediaSliders();
});
function initHeadingObserver() {
  const headings = document.querySelectorAll('h2[data-animate="heading"]');
  if (!headings.length) return;

  const obs = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-inview');
        obs.unobserve(entry.target);
      }
    });
  }, { threshold: 0.3 });

  headings.forEach(h => obs.observe(h));
}

document.addEventListener('DOMContentLoaded', () => {
  // ...lo que ya tenías...
  initHeadingObserver();
});
// ===============================
// Animación de headings (H2 nivel 2)
// ===============================
(function () {
  const animatedHeadings = document.querySelectorAll('[data-animate="heading"]');
  if (!animatedHeadings.length) return;

  if ('IntersectionObserver' in window) {
    const hObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-animated');
          hObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    animatedHeadings.forEach(h => hObserver.observe(h));
  } else {
    // Fallback si el browser no soporta IO
    animatedHeadings.forEach(h => h.classList.add('is-animated'));
  }
})();
document.addEventListener('DOMContentLoaded', () => {
  // HAMBURGUER NAV
  const toggle = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');

  if (toggle && mobileNav) {
    toggle.addEventListener('click', () => {
      const isHidden = mobileNav.hasAttribute('hidden');
      if (isHidden) {
        mobileNav.removeAttribute('hidden');
        toggle.setAttribute('aria-expanded', 'true');
      } else {
        mobileNav.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', 'false');
      }
    });

    // cerrar nav al hacer click en un link
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // BOTÓN VOLVER ARRIBA
  const scrollBtn = document.querySelector('.scroll-top');
  if (scrollBtn) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 400) {
        scrollBtn.classList.add('visible');
      } else {
        scrollBtn.classList.remove('visible');
      }
    });

    scrollBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // FORM BOOKING -> arma mail a Gmail
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const name = form.elements['name']?.value || '';
      const email = form.elements['email']?.value || '';
      const type = form.elements['type']?.value || '';
      const message = form.elements['message']?.value || '';

      const subject = 'Booking / Contacto - Manu Pavez';
      const bodyLines = [
        `Nombre: ${name}`,
        `Email: ${email}`,
        `Tipo de evento: ${type}`,
        '',
        'Mensaje:',
        message
      ];

      const body = bodyLines.join('\n');
      const mailto = `mailto:manupavez22@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      window.location.href = mailto;
    });
  }
});
