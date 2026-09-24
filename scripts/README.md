# scripts

## sync-music.js

Sincroniza el catálogo público de Spotify del artista y escribe `data/music.json`.

### Setup local

1. Crear app en https://developer.spotify.com/dashboard
2. Copiar Client ID + Client Secret
3. Exportar variables y correr:

```bash
export SPOTIFY_CLIENT_ID=xxx
export SPOTIFY_CLIENT_SECRET=yyy
npm run sync:music
```

### En GitHub Actions

Configurar en el repo:

- **Settings → Secrets and variables → Actions → Secrets**
  - `SPOTIFY_CLIENT_ID`
  - `SPOTIFY_CLIENT_SECRET`
- **Settings → Secrets and variables → Actions → Variables** (opcional)
  - `SPOTIFY_ARTIST_ID` — default `1m15KTr2Qsf1JkdkBam27h`

El workflow `.github/workflows/sync-music.yml` corre 1×/día a las 06:00 UTC y commitea `data/music.json` y `data/youtube.json` si hubo cambios. También se puede disparar a mano desde la pestaña Actions (botón **Run workflow**).

## YouTube (sin API key)

El mismo script genera `data/youtube.json` leyendo el **RSS público** del canal
(últimos ~15 videos, con sus vistas). No requiere API key.

- **Settings → Secrets and variables → Actions → Variables**
  - `YOUTUBE_CHANNEL_ID` — recomendado: `UCjrVcdq-MG3dMIV7DfAQo0g` (canal de Manu).
    Si no lo cargás, el script lo resuelve solo desde `YOUTUBE_HANDLE` (default `@manupavez`).

El front (`index.html`) usa `data/youtube.json` para el slider de videos y para el
contador de "Reproducciones totales" (suma las vistas del feed). `data/music.json`
alimenta releases, "Seguidores" y "Releases publicados".

### Límite honesto de "reproducciones totales"

El total real de streams de **Spotify** NO está en la API pública (ni followers de otras
plataformas). El contador suma lo automatizable gratis (vistas de YouTube). Para sumar el
resto, editá `data-count-base` en los `.stat` de `index.html`, o integrá un servicio pago
(Chartmetric / Songstats).

### Qué expone el JSON

```jsonc
{
  "updated_at": "...",
  "artist": { "followers": 0, "popularity": 0, ... },
  "stats": { "total_releases": 0, "top_tracks_popularity_avg": 0 },
  "releases": [ { "title": "Twenty Two", "release_date": "...", "artwork": "...", "spotify_url": "..." } ],
  "top_tracks": [ { "title": "...", "popularity": 0, "spotify_url": "..." } ]
}
```

### Limitación importante

**Spotify NO da "streams totales" en su API pública.** Lo que tenemos:

- `popularity` (0–100) por track/artista — proxy aceptable
- `followers.total` del artista
- Catálogo completo de releases con artwork y fechas

Para "monthly listeners" o conteo real de reproducciones se necesita:
- Spotify for Artists (manual) o
- API paga como Chartmetric / Songstats (~30–100 USD/mes)

## fechas/ (Google Sheet → eventos.json)

`fechas/automation.py` lee la planilla de fechas (vía la Web App de Apps Script) y genera
`eventos.json` en la raíz del sitio. Lo corre a diario el workflow `sync-fechas`.

```bash
# siempre desde la raíz del repo (lee .env de ahí y escribe eventos.json ahí)
pip install -r scripts/fechas/requirements.txt
python scripts/fechas/automation.py json
```

`fechas/apps_script/Codigo.gs` es una **copia de referencia** del script que vive en Google.
La `API_KEY` real se configura solo en el editor de Apps Script, nunca en el repo.
