// js/supabase-config.js
// Config global de Supabase. Se lee desde js/data/supabaseClient.js
window.MP_SUPABASE = {
  // Cloudflare Turnstile: clave del SITIO (pública). Vacía = sin captcha.
  // La clave SECRETA va solo en Supabase → Edge Functions → Secrets (TURNSTILE_SECRET_KEY).
  turnstileSiteKey: "0x4AAAAAAFBu2mhNLWmVNtOY",
  url: "https://psnprhzowknhfylvgcci.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnByaHpvd2tuaGZ5bHZnY2NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTM5MDQsImV4cCI6MjA4MTcyOTkwNH0.FFGPhYc_8J-U5BSvx0VGnpzmaGLoP-NX-6MRe0RMR0U"
};
