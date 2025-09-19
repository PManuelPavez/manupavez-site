// Render de lanzamientos desde data/releases.json
(function(){
  const GRID = document.getElementById('releases-grid');
  const BTN  = document.getElementById('load-more');
  const ERR  = document.getElementById('rel-error');
  if (!GRID) return;

  const PAGE_SIZE = 6;
  let all = [], page = 0;

  const ICON = { beatport:'BP', spotify:'SP', soundcloud:'SC', youtube:'YT', apple:'AP' };

  const fmt = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };

  const card = (it) => {
    const meta = [fmt(it.date), it.label].filter(Boolean).join(' • ');
    const links = it.links ? Object.entries(it.links).map(([k,href]) =>
      `<a class="chip" href="${href}" target="_blank" rel="noopener">${ICON[k]||'LINK'}<span class="sr-only"> ${k}</span></a>`
    ).join('') : '';
    return `<li class="release-card glass">
      <figure class="release-media">
        <img src="${it.cover}" alt="Cover: ${it.title}" loading="lazy" decoding="async" width="160" height="160">
      </figure>
      <div class="release-body">
        <h3 class="release-title">${it.title}</h3>
        <p class="release-meta">${meta}</p>
        ${it.notes ? `<p class="release-notes">${it.notes}</p>` : ''}
        <div class="release-links">${links}</div>
      </div>
    </li>`;
  };

  function renderMore(){
    const s = page * PAGE_SIZE;
    GRID.insertAdjacentHTML('beforeend', all.slice(s, s+PAGE_SIZE).map(card).join(''));
    page++;
    BTN.hidden = page * PAGE_SIZE >= all.length;
  }

  const validate = (arr) => arr.every(o => o.title && o.date && o.cover);
  DataClient.load('releases', validate)
    .then(({data}) => {
      all = data.slice().sort((a,b)=> new Date(b.date) - new Date(a.date));
      if (!all.length) throw new Error('Vacío');
      renderMore();
    })
    .catch(() => { ERR.hidden = false; });

  // El botón "Cargar más" se maneja mediante un modal personalizado definido en musica.html.
  // Por lo tanto no se añade el listener por defecto a renderMore en esta versión.
})();
