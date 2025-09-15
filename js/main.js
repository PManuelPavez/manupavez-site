/* =========================================================
   main.js – Header sintetizado + UX
   - Hamburguesa a la izquierda (overlay, ESC, click afuera)
   - CTA derecha
   - Hightlight activo (IntersectionObserver)
   - YouTube defer (carga iframe al click) – se ignora si no hay .yt-deferred
   - Fondo de video: ahorro (reduced-motion, data-saver, pestaña oculta, viewport chico)
   - Parallax sutil del glow
   ======================================================= */

document.addEventListener('DOMContentLoaded', () => {
  // ====== NAV ======
  const header = document.querySelector('.site-header');
  const toggle = document.querySelector('.menu-toggle');
  const panel  = document.getElementById('menu-panel');
  const overlay = document.querySelector('.menu-overlay');

  const openMenu = () => {
    toggle.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    panel.classList.add('open');
    overlay.hidden = false;
    overlay.classList.add('open');
    const firstLink = panel.querySelector('a');
    if (firstLink) firstLink.focus();
  };
  const closeMenu = () => {
    toggle.setAttribute('aria-expanded', 'false');
    panel.classList.remove('open');
    overlay.classList.remove('open');
    setTimeout(() => { panel.hidden = true; overlay.hidden = true; }, 160);
  };

  if (toggle && panel && overlay) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      expanded ? closeMenu() : openMenu();
    });
    overlay.addEventListener('click', closeMenu);
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) closeMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) { closeMenu(); toggle.focus(); }
    });
    panel.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  }

  // Sticky header
  const onScrollHeader = () => {
    if ((window.scrollY || window.pageYOffset) > 2) header.classList.add('is-stuck');
    else header.classList.remove('is-stuck');
  };
  onScrollHeader();
  window.addEventListener('scroll', onScrollHeader, { passive: true });

  // ====== ACTIVE LINK (por sección) ======
  const menuLinks = Array.from(document.querySelectorAll('#menu-panel a[href^="#"]'));
  const sections = menuLinks.map(a => a.getAttribute('href'))
    .filter(h => h && h.startsWith('#'))
    .map(id => document.querySelector(id)).filter(Boolean);

  const setActive = (id) => {
    menuLinks.forEach(a => {
      const match = a.getAttribute('href') === id;
      a.classList.toggle('is-active', match);
      a.setAttribute('aria-current', match ? 'true' : 'false');
    });
  };
  if (sections.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && entry.intersectionRatio > 0.55) {
          setActive('#' + entry.target.id);
        }
      });
    }, { rootMargin: '0px 0px -35% 0px', threshold: [0.55] });
    sections.forEach(sec => io.observe(sec));
  }

  // ====== YOUTUBE DEFER (se ejecuta sólo si existe .yt-deferred) ======
  const yt = document.querySelector('.yt-deferred');
  if (yt) {
    const btn = yt.querySelector('.yt-btn');
    const list = yt.getAttribute('data-yt-playlist') || '';
    const injectIframe = () => {
      const iframe = document.createElement('iframe');
      iframe.title = 'Playlist de YouTube de Manu Pavez';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.loading = 'lazy';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.src = `https://www.youtube.com/embed/videoseries?rel=0&modestbranding=1&playsinline=1&autoplay=1&list=${encodeURIComponent(list)}`;
      iframe.style.cssText = 'border:0;display:block;width:100%;height:100%';
      yt.innerHTML = '';
      yt.appendChild(iframe);
    };
    btn.addEventListener('click', injectIframe, { once: true });
  }

  // ====== Fondo: control video ======
  const video = document.getElementById('bgVideo');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
  const saveData = connection && connection.saveData;

  function applyMotionPref() {
    if (!video) return;
    if (prefersReduced.matches || saveData) { try { video.pause(); } catch {} video.style.display = 'none'; }
    else { video.style.display = ''; const p = video.play(); if (p && p.catch) p.catch(()=>{}); }
  }
  function handleVisibility() {
    if (!video) return;
    if (document.hidden) { try { video.pause(); } catch {} }
    else if (!prefersReduced.matches && !saveData) { const p = video.play(); if (p && p.catch) p.catch(()=>{}); }
  }
  function handleViewport() {
    if (!video) return;
    const small = window.innerWidth < 420 || window.innerHeight < 420;
    if (small) { try { video.pause(); } catch {} video.style.display = 'none'; }
    else if (!prefersReduced.matches && !saveData) { video.style.display = ''; const p = video.play(); if (p && p.catch) p.catch(()=>{}); }
  }

  applyMotionPref();
  prefersReduced.addEventListener('change', applyMotionPref);
  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('resize', handleViewport, { passive: true });
  handleViewport();

  // ====== Parallax sutil del glow (no del video) ======
  const bg = document.querySelector('.bg-anim');
  if (bg && !prefersReduced.matches) {
    const onScroll = () => {
      const y = window.scrollY || window.pageYOffset;
      const offset = y * 0.01;
      bg.style.backgroundPosition = `calc(50% + ${offset}px) calc(50% + ${offset}px)`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
});
