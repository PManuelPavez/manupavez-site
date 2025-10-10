// services-horizontal.js — layout horizontal con numeración y animación
(function(){
  const services = [
    { title: "Manager personal", text: "En TTM el artista cuenta con un acompañamiento cercano y constante. El manager personal se convierte en una herramienta integral que organiza, planifica y gestiona todas las áreas que componen al artista, tanto la humana como la de marca. El objetivo principal es que el artista pueda enfocarse plenamente en su arte y que mientras se entrega a esa pasión, se construya como individuo." },
    { title: "Estrategia de carrera y marca", text: "Trabajamos en la construcción de una identidad sólida y diferenciada, desarrollando un plan estratégico individualizado, hecho a medida del artista, que potencie la marca y trace un camino claro de crecimiento, con objetivos medibles y acciones concretas que generen impacto a largo plazo dentro de la industria." },
    { title: "Agenda interactiva", text: "Diseñamos y compartimos una agenda personalizada y digital en la que manager y artista trabajan en conjunto. Allí se definen objetivos SMART, se dividen en hitos y tareas, y se siguen con metodologías ágiles (Scrum, Sprints), asegurando organización, claridad y avances constantes." },
    { title: "Entrenamiento / Studio", text: "Contamos con un estudio de producción musical y una sala de entrenamiento de mezcla en nuestra oficina en Ciudad Autónoma de Buenos Aires. Este espacio está pensado para que los artistas puedan desarrollar su sonido, perfeccionar su técnica y crear sinergia entre ellos, compartiendo conocimientos e inspiración." },
    { title: "Desarrollo personal", text: "Sabemos que el éxito real comienza con la persona. Por eso brindamos herramientas de apoyo en salud mental, nutrición, entrenamiento físico y hábitos sostenibles, asegurando que el artista crezca en equilibrio y mantenga un rendimiento alto sin comprometer su bienestar." },
    { title: "Desarrollo de productos audiovisuales", text: "Contamos con un equipo de fotógrafos, filmmakers y community managers que generan contenido profesional y creativo. De esta manera, el artista puede comunicar su identidad con material propio, de calidad y alineado a su visión." },
    { title: "Press & media", text: "Gestionamos la relación con la prensa, medios y plataformas, elaborando estrategias de comunicación que amplifiquen el alcance del artista y aseguren una exposición coherente y positiva de la marca." },
    { title: "Logística y viajes", text: "Organizamos y coordinamos traslados, itinerarios y necesidades logísticas en cada fecha o gira. El objetivo es que el artista tenga una experiencia fluida y segura, pudiendo concentrarse en su performance sin preocuparse por los detalles operativos." },
    { title: "Booking, legal & negotiation", text: "Asesoramos y gestionamos negociaciones de contratos, bookings y acuerdos comerciales. Garantizamos transparencia, respaldo legal y condiciones justas que protejan al artista y fortalezcan su desarrollo profesional." },
    { title: "Espiritualidad", text: "En TTM entendemos que la carrera artística también es un camino personal profundo. Por eso ofrecemos acompañamiento espiritual y prácticas de conciencia que ayudan al artista a mantenerse en paz, conectado con su propósito y con claridad frente a los desafíos de la industria." }
  ];

  const container = document.getElementById("servicesList");
  if (!container) return;

  container.innerHTML = services.map((s, i) => `
    <div class="service-block">
      <div class="service-number">${String(i + 1).padStart(2, "0")}</div>
      <div class="service-content">
        <h3 class="service-title">${s.title}</h3>
        <p class="service-text">${s.text}</p>
      </div>
    </div>
  `).join("");
})();
