// booking.html — landing liviana para las historias de Instagram.
// Solo carga lo necesario: video de fondo, panel del formulario y envío.
import { initContactForm } from "../features/forms.js";
import { initHeroVideo, initBookingPanel } from "../features/bookingFlyer.js";
import { initBookingCalendar } from "../features/bookingCalendar.js";
import { initAnalytics } from "../core/analytics.js";

for (const [name, fn] of [["analytics", initAnalytics], ["contactForm", initContactForm], ["bookingPanel", initBookingPanel], ["heroVideo", initHeroVideo], ["calendar", initBookingCalendar]]) {
  try {
    fn();
  } catch (e) {
    console.error(`[init:${name}]`, e);
  }
}
