import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = "https://psnprhzowknhfylvgcci.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnByaHpvd2tuaGZ5bHZnY2NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYxNTM5MDQsImV4cCI6MjA4MTcyOTkwNH0.FFGPhYc_8J-U5BSvx0VGnpzmaGLoP-NX-6MRe0RMR0U";

window.supabase = createClient(supabaseUrl, supabaseKey);

console.log("SUPABASE OK", window.supabase);                 