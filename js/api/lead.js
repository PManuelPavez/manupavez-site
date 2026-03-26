import { Resend } from 'resend';

const resend = new Resend(process.env.re_KuHc2Mg4_JBT1FjZvGc242m6PeQtqgc6g);

export default async function handler(req, res) {
  try {
    const { name, email, level, goal, message } = req.body;

    await resend.emails.send({
      from: 'Frequency Lab <onboarding@resend.dev>',
      to: ['tuemail@gmail.com'],
      subject: 'Nuevo lead - Frequency Lab',
      html: `
        <h2>Nuevo Lead</h2>
        <p><strong>Nombre:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Nivel:</strong> ${level}</p>
        <p><strong>Objetivo:</strong> ${goal}</p>
        <p><strong>Mensaje:</strong> ${message}</p>
      `
    });

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error enviando email' });
  }
}