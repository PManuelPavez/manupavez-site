(() => {
  const modal = document.getElementById('musicModal');
  if (!modal) return;
  const openBtn = document.getElementById('load-more');
  const closeBtn = modal.querySelector('.modal-close');
  function open() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function close() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }
  if (openBtn) openBtn.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) close(); });
})();