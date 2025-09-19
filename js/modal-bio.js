(() => {
  const modal = document.getElementById('bioModal');
  if (!modal) return;
  const openBtn = document.querySelector('#bio .more-btn');
  const closeBtn = modal.querySelector('.modal-close');
  const bioContent = document.getElementById('bio-content');
  function open() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function close() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    // Restaura el estado del botón y colapsa el contenido original de bio
    if (bioContent) bioContent.setAttribute('data-expanded', 'false');
    if (openBtn) {
      openBtn.setAttribute('aria-expanded', 'false');
      openBtn.textContent = 'VER MÁS';
    }
  }
  if (openBtn) openBtn.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();