/* Cargador estable de JSON: cache local + retry + fallback */
const DataClient = (() => {
  const LS = window.localStorage;
  const MAX_AGE = 1000 * 60 * 30; // 30 min

  const key = (name) => `mp:data:${name}`;
  const now = () => Date.now();

  async function fetchJSON(url){
    const r = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }

  async function _load(name, validate){
    const url = `data/${name}.json`;
    const k = key(name);
    const cached = LS.getItem(k);

    // 1) devolver cache fresco si existe
    if (cached){
      try{
        const { t, data } = JSON.parse(cached);
        if (Array.isArray(data) && (now() - t) < MAX_AGE) return { data, from: 'cache' };
      }catch{}
    }

    // 2) red con 2 intentos
    let lastErr;
    for (let i=0; i<2; i++){
      try{
        const data = await fetchJSON(url);
        if (!Array.isArray(data)) throw new Error('Formato inválido');
        if (validate && !validate(data)) throw new Error('Datos no válidos');
        LS.setItem(k, JSON.stringify({ t: now(), data }));
        return { data, from: 'network' };
      }catch(e){ lastErr = e; }
    }

    // 3) fallback: cache viejo si al menos hay algo
    if (cached){
      try{
        const { data } = JSON.parse(cached);
        if (Array.isArray(data)) return { data, from: 'stale-cache' };
      }catch{}
    }
    throw lastErr || new Error('No se pudo cargar');
  }

  return {
    load: (name, validate) => _load(name, validate),
    clear: (name) => LS.removeItem(key(name))
  };
})();
