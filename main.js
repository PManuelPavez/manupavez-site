// 🍔 Toggle accesible del menú móvil
document.addEventListener('DOMContentLoaded', function () {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('main-nav');

  toggle.addEventListener('click', function () {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', !expanded);
    nav.classList.toggle('show');
  });
});

// 🌫️ Parallax muy sutil del fondo (si no se prefiere reducción de movimiento)
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  window.addEventListener('scroll', () => {
    const scrollY = window.scrollY;
    const bg = document.querySelector('.bg-anim');
    if (bg) {
      bg.style.transform = `translate(${scrollY * 0.01}px, ${scrollY * 0.01}px)`;
    }
  });
}
