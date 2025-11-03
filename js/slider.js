/* slider.js: simple slideshow with dots, autoslide */
document.addEventListener('DOMContentLoaded', () => {
  const slides = document.querySelectorAll('.slider .slides img');
  const dotsWrap = document.querySelector('.slider-dots');
  if (!slides.length || !dotsWrap) return;

  let current = 0;
  // build dots
  slides.forEach((_, i) => {
    const btn = document.createElement('button');
    btn.className = 'dot';
    btn.setAttribute('aria-label', `Mostrar imagen ${i+1}`);
    btn.addEventListener('click', () => show(i));
    dotsWrap.appendChild(btn);
  });
  const dots = dotsWrap.querySelectorAll('.dot');

  function show(i) {
    slides[current].classList.remove('active');
    dots[current].classList.remove('active');
    current = i;
    slides[current].classList.add('active');
    dots[current].classList.add('active');
  }

  function next() {
    show((current + 1) % slides.length);
  }

  show(0);
  const interval = setInterval(next, 5000);

  // pause on hover (accessibility)
  const slider = document.querySelector('.slider');
  if (slider) {
    slider.addEventListener('mouseenter', () => clearInterval(interval));
  }
});
