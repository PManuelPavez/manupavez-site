// Counters animados on-scroll. Los valores dinámicos (followers/releases) se
// toman de data/music.json (auto-sync Spotify); el resto son configurables en el HTML.
export function initCounters() {
  const nodes = Array.from(document.querySelectorAll("[data-counter]"));
  if (!nodes.length) return;

  const fmt = (n) => Math.round(n).toLocaleString("es-AR");
  const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Rellena targets dinámicos desde music.json (no bloquea si no existe)
  hydrateDynamicTargets(nodes);

  const animate = (el) => {
    const to = Number(el.dataset.countTo || 0);
    const suffix = el.dataset.countSuffix || "";
    if (prefersReduced || !to) {
      el.textContent = fmt(to) + suffix;
      return;
    }

    const duration = 1500;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = fmt(to * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver(
    (entries, obs) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        // Si el target dinámico todavía no cargó, esperamos un toque
        const run = () => animate(entry.target);
        if (entry.target.dataset.countReady === "pending") {
          setTimeout(run, 400);
        } else {
          run();
        }
        obs.unobserve(entry.target);
      }
    },
    { threshold: 0.4 }
  );

  nodes.forEach((n) => io.observe(n));
}

async function hydrateDynamicTargets(nodes) {
  const dynamic = nodes.filter((n) => n.dataset.countSource);
  if (!dynamic.length) return;
  dynamic.forEach((n) => (n.dataset.countReady = "pending"));

  // music.json (Spotify) y youtube.json (RSS) en paralelo; cualquiera puede faltar.
  const [music, youtube] = await Promise.all([
    fetchJson("data/music.json"),
    fetchJson("data/youtube.json"),
  ]);

  for (const n of dynamic) {
    const src = n.dataset.countSource;
    // base manual opcional: suma lo que no se puede automatizar (otras plataformas)
    const base = Number(n.dataset.countBase || 0);
    let dyn = 0;

    if (src === "followers") {
      dyn = music?.artist?.followers ?? 0;
    } else if (src === "releases") {
      dyn = music?.stats?.total_releases ?? music?.releases?.length ?? 0;
    } else if (src === "plays") {
      // reproducciones auto disponibles gratis: las de YouTube (suma del RSS)
      dyn = youtube?.total_views ?? 0;
    }

    const val = base + dyn || Number(n.dataset.countTo || 0);
    n.dataset.countTo = String(val);
    n.dataset.countReady = "ready";
  }
}

async function fetchJson(path) {
  try {
    const res = await fetch(path, { cache: "no-cache" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
