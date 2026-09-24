// js/core/i18n.js
// Idioma de la página según <html lang>: "en" en /en/*, "es" en el resto.
// Los textos fijos viven en cada HTML (index.html / en/index.html); acá solo
// los strings que arma el JS (fechas, mensajes de error, labels dinámicos).

export const lang = (document.documentElement.lang || "es").toLowerCase().startsWith("en") ? "en" : "es";
export const locale = lang === "en" ? "en-US" : "es-AR";

// Raíz del sitio, calculada desde este archivo (js/core/ → ../../).
// Así "data/music.json" resuelve igual desde /index.html que desde /en/index.html.
const ROOT = new URL("../../", import.meta.url);
export const siteUrl = (path) => new URL(path, ROOT).href;

const STRINGS = {
  es: {
    listenOnSpotifyAria: (title) => `Escuchar ${title} en Spotify — se abre en una pestaña nueva`,
    listenOnSpotify: "Escuchar en Spotify",
    coverAlt: (title) => `Portada — ${title}`,
    comingToPlatforms: "Próximamente en plataformas.",
    close: "Cerrar",
    watchOnYouTube: "Ver en YouTube",
    listen: "Escuchar",
    comingSoon: "Próximamente",
    noShows: "Pronto nuevas fechas. Seguime para no perderte ninguna.",
    showsError: "No se pudieron cargar las fechas por ahora.",
    igPostTitle: "Publicación de Instagram",
    viewPhoto: (n) => `Ver foto ${n}`,
    form: {
      name: "Decime tu nombre.",
      email: "Necesito un mail para responderte.",
      emailInvalid: "Ese mail no parece válido.",
      type: "Elegí un tipo de evento.",
      message: "Contame un poco del evento.",
      checkFields: "Revisá los campos marcados.",
      sending: "Enviando…",
      fallback: "No pude enviar automático. Te abro el mail como plan B.",
      sent: "¡Enviado! Te respondo a la brevedad.",
    },
  },
  en: {
    listenOnSpotifyAria: (title) => `Listen to ${title} on Spotify — opens in a new tab`,
    listenOnSpotify: "Listen on Spotify",
    coverAlt: (title) => `Artwork — ${title}`,
    comingToPlatforms: "Coming soon to platforms.",
    close: "Close",
    watchOnYouTube: "Watch on YouTube",
    listen: "Listen",
    comingSoon: "Coming soon",
    noShows: "New dates coming soon. Follow along so you don't miss any.",
    showsError: "Couldn't load the dates right now.",
    igPostTitle: "Instagram post",
    viewPhoto: (n) => `View photo ${n}`,
    form: {
      name: "Please tell me your name.",
      email: "I need an email to reply to you.",
      emailInvalid: "That email doesn't look valid.",
      type: "Pick an event type.",
      message: "Tell me a bit about the event.",
      checkFields: "Please check the highlighted fields.",
      sending: "Sending…",
      fallback: "Couldn't send automatically. Opening your email app as plan B.",
      sent: "Sent! I'll get back to you soon.",
    },
  },
};

export const t = STRINGS[lang];
