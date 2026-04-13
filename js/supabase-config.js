import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = "https://psnprhzowknhfylvgcci.supabase.co";
const supabaseKey = "TU_ANON_KEY";

window.supabase = createClient(supabaseUrl, supabaseKey);

console.log("SUPABASE OK", window.supabase);