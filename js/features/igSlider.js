import { prefersReducedMotion } from "../core/motion.js";

/**
 * Slider del feed de Instagram (Swiper.js) con embeds OFICIALES de Instagram.
 *
 * Cómo agregar/editar posts:
 *   Pegá las URLs de los posts en IG_POSTS (abajo). Sirven los formatos:
 *     https://www.instagram.com/p/XXXXXXXXXXX/
 *     https://www.instagram.com/reel/XXXXXXXXXXX/
 *   El orden de la lista es el orden en que aparecen en el slider.
 *
 * Notas:
 * - Los embeds oficiales se renderizan con su propio estilo (fondo claro).
 * - Swiper se carga por CDN (window.Swiper). Si no está disponible o el
 *   usuario pide menos movimiento, salimos elegantemente y queda el fallback
 *   "Ver más en Instagram".
 */
const IG_POSTS = [
  "https://www.instagram.com/p/DSnzfXkj0yd/",
  "https://www.instagram.com/p/DHrsQnAsyHu/",
  "https://www.instagram.com/p/DGO9n4VMOVZ/",
  "https://www.instagram.com/p/DPPoFVhjC3-/",
];

/** Extrae el shortcode de una URL de post/reel/tv de Instagram. */
function getShortcode(url) {
  const m = String(url).match(/instagram\.com\/(?:p|reel|tv)\/([^/?#]+)/i);
  return m ? m[1] : null;
}

export function initIgSlider() {
  const el = document.querySelector(".ig-swiper");
  if (!el) return;

  const wrapper = el.querySelector(".swiper-wrapper");
  if (!wrapper) return;

  const codes = IG_POSTS.map(getShortcode).filter(Boolean);

  // Sin posts cargados: ocultamos el slider y dejamos solo el fallback.
  if (codes.length === 0) {
    el.style.display = "none";
    return;
  }

  // Construimos un slide por post con el embed oficial de Instagram.
  wrapper.innerHTML = codes
    .map(
      (code) => `
      <div class="swiper-slide">
        <iframe
          class="ig-embed"
          src="https://www.instagram.com/p/${code}/embed/"
          loading="lazy"
          scrolling="no"
          allowtransparency="true"
          frameborder="0"
          title="Publicación de Instagram"
        ></iframe>
      </div>`
    )
    .join("");

  if (!window.Swiper) {
    console.warn("[igSlider] Swiper no disponible — se muestran los embeds sin slider");
    return;
  }

  const reduce = prefersReducedMotion();

  // El loop infinito de Swiper necesita bastante más slides que los visibles.
  // Con pocos posts lo desactivamos para evitar saltos (queda igual deslizable).
  const enoughForLoop = codes.length >= 6;

  new window.Swiper(el, {
    loop: enoughForLoop,
    grabCursor: true,
    speed: 800,
    spaceBetween: 18,
    slidesPerView: 1.1,
    centeredSlides: false,

    // Autoplay lento (off si pocos posts o si el usuario pide menos movimiento)
    autoplay:
      reduce || !enoughForLoop
        ? false
        : {
            delay: 5000,
            disableOnInteraction: false,
            pauseOnMouseEnter: true,
          },

    // Responsive: los embeds necesitan ancho, así que mostramos menos por vista
    breakpoints: {
      640: { slidesPerView: 1.6, spaceBetween: 18 },
      768: { slidesPerView: 2, spaceBetween: 20 },
      1024: { slidesPerView: 3, spaceBetween: 22 },
      1440: { slidesPerView: 3, spaceBetween: 26 },
    },
  });
}
