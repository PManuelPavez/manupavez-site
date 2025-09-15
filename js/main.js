/* =========================================================
   main.js – Manu Pavez
   - Toggle accesible del menú móvil (aria-expanded)
   - Parallax MUY sutil del fondo (0.01), desactivado si reduced motion
   - Cómo cambiar logo: reemplazá img/logo.svg; el texto fallback es "Manu Pavez"
   ======================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('main-nav');

  if (toggle && nav) {
    // Toggle del menú
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      nav.classList.toggle('show');
    });

    // Cerrar al hacer click en un link (mobile)
    nav.addEventListener('click', (e) => {
      const isLink = e.target.closest('a');
      if (isLink && window.getComputedStyle(toggle).display !== 'none') {
        toggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('show');
      }
    });

    // Cerrar con ESC
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && nav.classList.contains('show')) {
        toggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('show');
        toggle.focus();
      }
    });
  }

  // Parallax MUY sutil (0.01) sobre background-position (no rompe la animación CSS)
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const bg = document.querySelector('.bg-anim');

  if (bg && !prefersReduced) {
    const onScroll = () => {
      const y = window.scrollY || window.pageYOffset;
      const offset = y * 0.01; // factor de parallax
      // Mover el background en ambas direcciones, sin tocar transform (no interfiere con la animación)
      bg.style.backgroundPosition = `calc(50% + ${offset}px) calc(50% + ${offset}px)`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
});
