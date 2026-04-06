// supabase/functions/send-lead-email/index.ts

import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  try {
    const { name, email, level, goal, message } = await req.json();

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    // Validación básica (evita errores silenciosos)
    if (!RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Falta API KEY de Resend" }),
        { status: 500 }
      );
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "onboarding@resend.dev",
        to: ["manupavez22@gmail.com"], // 👈 tu mail (mismo de Resend)
        subject: "Nuevo lead - Frequency Lab",
        html: `
          <h2>Nuevo Lead</h2>
          <p><b>Nombre:</b> ${name}</p>
          <p><b>Email:</b> ${email}</p>
          <p><b>Nivel:</b> ${level}</p>
          <p><b>Objetivo:</b> ${goal}</p>
          <p><b>Mensaje:</b> ${message}</p>
        `
      })
    });

    const data = await resendRes.json();

    // 🔥 ESTO ES LO IMPORTANTE
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
      status: resendRes.status
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Error en la function", detail: err.message }),
      { status: 500 }
    );
  }
});