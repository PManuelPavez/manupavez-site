import { serve } from "https://deno.land/std/http/server.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  const { name, email, level, goal, message } = await req.json();

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "onboarding@resend.dev",
      to: ["manupavez22@gmail.com"],
      subject: "Nuevo lead",
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

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
});