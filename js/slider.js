// Slider simple para la sección de fotos del presskit.
// Utiliza transformaciones CSS para mostrar una diapositiva a la vez.
// Sin dependencias externas; respeta la CSP al cargar como script externo.

(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const slider = document.querySelector('.photo-slider');
    if (!slider) return;

    const slidesContainer = slider.querySelector('.slides');
    const slides = Array.from(slidesContainer.children);
    const prevBtn = slider.querySelector('.prev');
    const nextBtn = slider.querySelector('.next');
    const navDots = Array.from(slider.querySelectorAll('.slider-nav button'));
    let currentIndex = 0;
    let autoInterval;

    function update() {
      // Mueve el contenedor para mostrar la diapositiva actual
      slidesContainer.style.transform = `translateX(-${currentIndex * 100}%)`;
      // Actualiza los indicadores activos
      navDots.forEach((dot, idx) => {
        if (idx === currentIndex) {
          dot.classList.add('active');
        } else {
          dot.classList.remove('active');
        }
      });
    }

    function goTo(index) {
      currentIndex = (index + slides.length) % slides.length;
      update();
    }

    function next() {
      goTo(currentIndex + 1);
    }

    function prev() {
      goTo(currentIndex - 1);
    }

    prevBtn.addEventListener('click', prev);
    nextBtn.addEventListener('click', next);
    navDots.forEach((dot, idx) => {
      dot.addEventListener('click', () => goTo(idx));
    });

    function startAuto() {
      stopAuto();
      autoInterval = setInterval(() => {
        next();
      }, 7000);
    }

    function stopAuto() {
      if (autoInterval) clearInterval(autoInterval);
    }

    // Inicia la reproducción automática, pausa al pasar el cursor
    slider.addEventListener('mouseenter', stopAuto);
    slider.addEventListener('mouseleave', startAuto);

    update();
    startAuto();
  });
})();