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

El workflow `.github/workflows/sync-music.yml` corre 1×/día a las 06:00 UTC y commitea `data/music.json` si hubo cambios. También se puede disparar a mano desde la pestaña Actions.

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
