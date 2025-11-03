/* main.js
   - menú movil accesible
   - time local
   - accordion (story)
   - lazy load iframe/video where applicable
   - smooth internal scroll
*/

/* DOM ready */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Menu móvil toggle
  const menuToggle = document.querySelector('.menu-toggle');
  const mobileNav = document.getElementById('mobile-nav');
  if (menuToggle && mobileNav) {
    menuToggle.addEventListener('click', () => {
      const opened = mobileNav.hidden === false;
      mobileNav.hidden = opened;
      menuToggle.setAttribute('aria-expanded', String(!opened));
    });
    // close mobile nav when clicking a link
    mobileNav.addEventListener('click', e => {
      if (e.target.tagName === 'A') {
        mobileNav.hidden = true;
        menuToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // 2. Local time display (updates every minute)
  const timeEl = document.getElementById('local-time');
  if (timeEl) {
    const updateTime = () => {
      const now = new Date();
      timeEl.textContent = now.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    };
    updateTime();
    setInterval(updateTime, 60000);
  }

  // 3. Smooth scroll for internal anchors (respect reduce motion)
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', (e) => {
        const href = a.getAttribute('href');
        const target = href && document.querySelector(href);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  // 4. Accordion chapters
  document.querySelectorAll('.chapter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const article = btn.parentElement;
      const open = article.classList.contains('active');
      // close any open if you want one-at-a-time:
      document.querySelectorAll('.chapter').forEach(c => {
        c.classList.remove('active');
        const b = c.querySelector('.chapter-btn');
        if (b) b.setAttribute('aria-expanded', 'false');
        const content = c.querySelector('.chapter-content');
        if (content) content.hidden = true;
      });
      if (!open) {
        article.classList.add('active');
        btn.setAttribute('aria-expanded', 'true');
        const content = article.querySelector('.chapter-content');
        if (content) content.hidden = false;
      }
    });
  });

  // 5. Deferred load for Spotify / YouTube iframes -> using loading="lazy" already
  // Extra: add IntersectionObserver for a11y/perf if necessary (omitted for simplicity)

  // 6. Respect prefers-reduced-motion: if set, remove animations
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('reduced-motion');
  }
});
