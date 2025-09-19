/* =========================================================
   main.js – MPA UX:
   - Menú accesible (burger), overlay, ESC, click afuera
   - Sticky header
   - Fondo: carga diferida del video (landing), ahorro recursos
   - Parallax sutil del glow
   - Loader entre páginas
   - BIO "VER MÁS"
   - Link activo por página (body[data-page])
   - SW opcional
   ======================================================= */

document.addEventListener('DOMContentLoaded', () => {
  // ===== NAV =====
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
  // Throttle the scroll handler using requestAnimationFrame to avoid running
  // on every scroll event.  This limits updates to once per frame (~60 Hz)
  let tickingHeader = false;
  const handleSticky = () => {
    const y = window.scrollY || window.pageYOffset;
    if (y > 2) header.classList.add('is-stuck');
    else header.classList.remove('is-stuck');
    tickingHeader = false;
  };
  const onScrollHeader = () => {
    if (!tickingHeader) {
      window.requestAnimationFrame(handleSticky);
      tickingHeader = true;
    }
  };
  onScrollHeader();
  window.addEventListener('scroll', onScrollHeader, { passive: true });
});

// ===== Fondo: carga diferida + ahorro =====
(() => {
  const video = document.getElementById('bgVideo');
  if (!video) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection || navigator.webkitConnection || navigator.mozConnection;
  const saveData = connection && connection.saveData;

  function primeSources() {
    const sources = video.querySelectorAll('source[data-src]');
    let changed = false;
    sources.forEach(s => {
      if (!s.src) { s.src = s.getAttribute('data-src'); changed = true; }
    });
    if (changed) video.load();
  }

  function enableVideo() {
    primeSources();
    video.style.display = '';
    const play = video.play();
    if (play && play.catch) play.catch(()=>{});
  }

  function disableVideo() {
    try { video.pause(); } catch {}
    video.style.display = 'none';
  }

  function applyPolicy() {
    const small = window.innerWidth < 420 || window.innerHeight < 420;
    if (prefersReduced.matches || saveData || small || document.hidden) {
      disableVideo();
    } else {
      enableVideo();
    }
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(applyPolicy, { timeout: 1200 });
  } else {
    setTimeout(applyPolicy, 700);
  }

  prefersReduced.addEventListener('change', applyPolicy);
  document.addEventListener('visibilitychange', applyPolicy);
  window.addEventListener('resize', applyPolicy, { passive: true });
})();

// ===== Parallax sutil del glow =====
(() => {
  const bg = document.querySelector('.bg-anim');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (!bg || prefersReduced.matches) return;

  // Throttle parallax updates via requestAnimationFrame to avoid layout thrashing
  let ticking = false;
  const updateParallax = () => {
    const y = window.scrollY || window.pageYOffset;
    const offset = y * 0.01;
    bg.style.backgroundPosition = `calc(50% + ${offset}px) calc(50% + ${offset}px)`;
    ticking = false;
  };
  const onScroll = () => {
    if (!ticking) {
      window.requestAnimationFrame(updateParallax);
      ticking = true;
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// ===== Loader: entrada y navegación =====
document.addEventListener('DOMContentLoaded', () => {
  const loader = document.querySelector('.page-loader');
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hide = () => { if (loader) loader.classList.add('is-hidden'); };
  if (!prefersReduced) { window.addEventListener('load', hide, { once:true }); setTimeout(hide, 1000); }
  else { hide(); }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a) return;
    const url = new URL(a.href, location.href);
    const sameOrigin = url.origin === location.origin;
    const toHTML = /\.html?$/.test(url.pathname);
    const newTab = a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    if (sameOrigin && toHTML && !newTab) { if (loader && !prefersReduced) loader.classList.remove('is-hidden'); }
  }, { passive:true });
});

// ===== BIO: Ver más / Ver menos =====
document.addEventListener('DOMContentLoaded', () => {
  const bio = document.getElementById('bio-content');
  const btn = document.querySelector('#bio .more-btn');
  if (!bio || !btn) return;
  const update = (exp) => {
    bio.setAttribute('data-expanded', String(exp));
    btn.setAttribute('aria-expanded', String(exp));
    btn.textContent = exp ? 'VER MENOS' : 'VER MÁS';
  };
  btn.addEventListener('click', () => update(bio.getAttribute('data-expanded') !== 'true'));
});

// ===== Link activo por página =====
document.addEventListener('DOMContentLoaded', () => {
  const page = (document.body.getAttribute('data-page') || '').toLowerCase();
  if (!page) return;
  const links = document.querySelectorAll('#menu-panel a[href]');
  links.forEach(a => {
    try {
      const url = new URL(a.getAttribute('href'), location.href);
      const name = url.pathname.split('/').pop().replace('.html','').toLowerCase();
      const match = (page === 'index' && (name === '' || name === 'index')) || (page === name);
      a.classList.toggle('is-active', !!match);
      a.setAttribute('aria-current', match ? 'true' : 'false');
    } catch(e){}
  });
});

// ===== Service Worker opcional =====
// ===== Service Worker opcional =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => {});
  });
}

// ===== Ajusta --header-h al alto real del header (para centrar la landing) =====
document.addEventListener('DOMContentLoaded', () => {
  const setHeaderVar = () => {
    const h = document.querySelector('.site-header');
    if (!h) return;
    const hh = Math.round(h.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--header-h', `${hh}px`);
  };
  setHeaderVar();
  // Actualiza el valor al cambiar el tamaño de la ventana u orientación
  window.addEventListener('resize', setHeaderVar, { passive: true });
  window.addEventListener('orientationchange', setHeaderVar);
});

// ===== Lightbox de fotos (grid con data-gallery) =====
document.addEventListener('DOMContentLoaded', () => {
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Crea la capa una sola vez
  const layer = document.createElement('div');
  layer.className = 'lb-layer';
  layer.innerHTML = `
    <figure class="lb-figure" role="dialog" aria-modal="true" aria-label="Visor de fotos">
      <button class="lb-close" type="button" aria-label="Cerrar"></button>
      <button class="lb-prev"  type="button" aria-label="Anterior"></button>
      <img alt="">
      <button class="lb-next"  type="button" aria-label="Siguiente"></button>
    </figure>
  `;
  document.body.appendChild(layer);
  const fig   = layer.querySelector('.lb-figure');
  const imgEl = layer.querySelector('img');
  const btnPrev = layer.querySelector('.lb-prev');
  const btnNext = layer.querySelector('.lb-next');
  const btnClose= layer.querySelector('.lb-close');

  let items = [];  // array de {src, alt}
  let index = 0;
  let lastFocus = null;

  function openAt(i){
    index = i;
    const it = items[index];
    imgEl.src = '';
    imgEl.alt = it.alt || '';
    layer.classList.add('open');
    document.documentElement.style.overflow = 'hidden'; // bloquea scroll
    if (!prefersReduced) imgEl.style.opacity = '0';
    // carga imagen
    const pic = new Image();
    pic.onload = () => {
      imgEl.src = pic.src;
      if (!prefersReduced){
        requestAnimationFrame(() => {
          imgEl.style.transition = 'opacity .18s ease';
          imgEl.style.opacity = '1';
        });
      }
    };
    pic.src = it.src;
    btnClose.focus();
  }
  function close(){
    layer.classList.remove('open');
    document.documentElement.style.overflow = '';
    imgEl.src = '';
    if (lastFocus) lastFocus.focus();
  }
  function next(){ openAt((index+1) % items.length); }
  function prev(){ openAt((index-1+items.length) % items.length); }

  // Eventos de capa
  btnClose.addEventListener('click', close);
  btnNext.addEventListener('click', next);
  btnPrev.addEventListener('click', prev);
  layer.addEventListener('click', (e) => { if (e.target === layer) close(); });
  document.addEventListener('keydown', (e) => {
    if (layer.classList.contains('open')){
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
    }
  });

  // Swipe básico móvil
  let sx = 0, sy = 0;
  layer.addEventListener('touchstart', (e) => {
    const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
  }, {passive:true});
  layer.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy;
    if (Math.abs(dx) > 40 && Math.abs(dy) < 60){
      dx < 0 ? next() : prev();
    }
  }, {passive:true});

  // Delegación: cualquier .photo-grid[data-gallery] crea galería
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.photo-grid[data-gallery] img');
    if (!img) return;
    const grid = img.closest('.photo-grid[data-gallery]');
    const galleryImgs = Array.from(grid.querySelectorAll('img'));
    items = galleryImgs.map(el => ({
      src: el.getAttribute('data-src') || el.currentSrc || el.src,
      alt: el.alt || ''
    }));
    const i = galleryImgs.indexOf(img);
    lastFocus = img;
    openAt(i);
  });
});
// Año automático en el footer (opcional)
document.addEventListener('DOMContentLoaded', () => {
  const y = document.getElementById('y');
  if (y) y.textContent = new Date().getFullYear();
});
// Sincroniza --header-h con el alto real del header (para centrar la landing)
document.addEventListener('DOMContentLoaded', () => {
  const setHeaderVar = () => {
    const head = document.querySelector('.site-header');
    if (!head) return;
    const h = Math.round(head.getBoundingClientRect().height);
    document.documentElement.style.setProperty('--header-h', `${h}px`);
  };
  setHeaderVar();
  window.addEventListener('resize', setHeaderVar, { passive: true });
  window.addEventListener('orientationchange', setHeaderVar);
});


