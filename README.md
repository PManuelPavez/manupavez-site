# manupavez.com

Sitio de Manu Pavez (DJ / productor) + **Frequency Lab**: portal de alumnos, shop y pagos.
HTML/CSS/JS sin build, publicado en GitHub Pages. Backend en Supabase (Postgres + Auth + Edge Functions).

## Estructura

```
/                       Páginas públicas (una por URL) + eventos.json + CNAME
│  index.html           Home
│  clinicas.html        Frequency Lab (popup de entrada: aplicar / soy alumno)
│  aplicar.html         Landing del link de Instagram (form de aplicación)
│  alumnos.html         Espacio del alumno (aparte del sitio, login por PIN)
│  shop.html            Sesiones y servicios (MercadoPago)
│  admin.html           Panel del Lab (solo admin)
│  bio.html · presskit.html · GROOVIN2026.html
│
├─ css/                 base → layout → components → pages/<página>.css
├─ js/
│  ├─ main.js           Entrada del sitio público (inicializa features por página)
│  ├─ supabase-config.js  URL + anon key (públicas) + site key de Turnstile (pública)
│  ├─ core/             Utilidades (DOM, motion, observers)
│  ├─ data/             Acceso a datos (Supabase, lab.js, leads)
│  ├─ features/         Módulos de UI reutilizables (portal, PIN, Turnstile, sliders…)
│  ├─ pages/            Lógica por página (alumnos.js, admin.js, shop.js, home.js…)
│  └─ ui/               Renderers
├─ img/ · logos/        Imágenes (optimizadas: webp/jpg/png livianos)
├─ data/                music.json · youtube.json (los genera un workflow)
│
├─ supabase/            ⚠ NO se publica
│  ├─ migrations/       Esquema, RLS y funciones (en orden)
│  ├─ functions/        Edge Functions (ver abajo)
│  └─ legacy/           SQL viejo de referencia
├─ scripts/             ⚠ NO se publica · herramientas (sync de música, fechas)
├─ docs/                ⚠ NO se publica · guías internas, promotores, exports
└─ .github/workflows/   deploy-pages · sync-music · sync-fechas
```

## Publicación

`deploy-pages.yml` publica **solo** páginas, `css/ js/ img/ logos/ data/`, `eventos.json` y `CNAME`.
Todo lo interno (supabase, scripts, docs) queda en el repo pero **no** en manupavez.com.
Requisito único: *Settings → Pages → Source: GitHub Actions*.

El push lo hace Manu, a mano.

## Seguridad (resumen)

- **Cero secretos en el repo.** El navegador solo tiene la anon key y la site key de Turnstile (públicas por diseño).
- **RLS en todas las tablas.** Cada alumno ve solo lo suyo y solo con acceso vigente; el admin ve todo.
- **Login:** PIN de 6 dígitos (HMAC con clave en Vault, 5 intentos por conexión, 20 por hora en total, Turnstile).
  Magic link como respaldo. Un email que no es alumno no puede crear cuenta (control en la base).
- **Pagos:** el monto en ARS lo calcula el servidor (dólar MEP fijado en la orden). El webhook valida la
  firma de MercadoPago, vuelve a consultar el pago en su API y procesa cada pago una sola vez.
- **CSP estricta** en `alumnos`, `admin` y `shop`.

### Secretos (Supabase → Edge Functions → Secrets)

| Secreto | Para qué |
|---|---|
| `NOTION_TOKEN` | Sync de Notion (solo lectura) |
| `RESEND_API_KEY` | Mails al admin |
| `TURNSTILE_SECRET_KEY` | Anti-bots en PIN y shop |
| `MP_ACCESS_TOKEN` · `MP_WEBHOOK_SECRET` | MercadoPago |

Los secretos de cron (`notion_sync_secret`, `lab_notify_secret`) y la clave de PINs (`pin_pepper`) se
generan dentro de la base, en Vault: nadie los ve ni los copia.

## Edge Functions

| Función | Quién la llama | Qué hace |
|---|---|---|
| `notion-sync` | cron cada hora · botón del panel | Copia alumnos, sesiones y páginas de Notion |
| `pin-login` | popup / `alumnos` | Login por PIN |
| `lab-notify` | cron cada 5 min (solo si hay novedades) | Mail al admin: tracks y misiones |
| `mp-checkout` | `shop` · panel (link especial) | Crea la orden y el link de MercadoPago |
| `mp-webhook` | MercadoPago | Confirma el pago y activa lo que corresponde |
| `send-lead-email` | — | Mail de leads (Resend) |

Deploy de una función (desde la raíz):
`supabase functions deploy <nombre> --project-ref psnprhzowknhfylvgcci --use-api --no-verify-jwt`

## Desarrollo local

```
npm run dev          # http://localhost:5173
```

## Tareas automáticas

| Qué | Dónde | Frecuencia |
|---|---|---|
| Música (Spotify/YouTube → `data/`) | GitHub Actions `sync-music` | diaria |
| Fechas (Google Sheet → `eventos.json`) | GitHub Actions `sync-fechas` | diaria |
| Notion → portal de alumnos | Supabase cron | cada hora |
| Avisos al admin | Supabase cron | cada 5 min |
| Vencer órdenes sin pagar | Supabase cron | diaria |

Guía de uso para el día a día: `docs/COMO-USAR-LA-WEB.md`.
