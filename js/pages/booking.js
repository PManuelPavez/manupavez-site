// booking.html — landing liviana para las historias de Instagram.
// Solo carga lo necesario: video de fondo, panel del formulario y envío.
import { initContactForm } from "../features/forms.js";
import { initHeroVideo, initBookingPanel } from "../features/bookingFlyer.js";

for (const [name, fn] of [["contactForm", initContactForm], ["bookingPanel", initBookingPanel], ["heroVideo", initHeroVideo]]) {
  try {
    fn();
  } catch (e) {
    console.error(`[init:${name}]`, e);
  }
}
