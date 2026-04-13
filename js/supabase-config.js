
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// 🔹 tus datos
const supabaseUrl = "https://psnprhzowknhfylvgcci.supabase.co";
const supabaseKey = "  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnByaHpvd2tuaGZ5bHZnY2NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTM5MDQsImV4cCI6MjA4MTcyOTkwNH0.FFGPhYc_8J-U5BSvx0VGnpzmaGLoP-NX-6MRe0RMR0U",
";

// 🔥 CREAR CLIENTE REAL
window.supabase = createClient(supabaseUrl, supabaseKey);

// (opcional) mantener tu objeto si lo usás en otro lado
window.MP_SUPABASE = {
  url: supabaseUrl,
  anonKey: supabaseKey
};