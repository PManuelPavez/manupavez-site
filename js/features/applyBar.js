// Botón fijo "APLICAR AL LAB" (solo celular, /clinicas). Aparece cuando la portada ya quedó
// atrás y se esconde mientras el formulario está a la vista. Lleva directo a #reservar.
export function initApplyBar() {
  const bar = document.querySelector("[data-apply-bar]");
  const hero = document.querySelector(".lab-hero-section");
  const form = document.getElementById("reservar");
  if (!bar || !hero || !form || !("IntersectionObserver" in window)) return;

  let heroVisible = true;
  let formVisible = false;
  const update = () => {
    const show = !heroVisible && !formVisible;
    bar.hidden = false;
    bar.classList.toggle("is-on", show);
    bar.setAttribute("aria-hidden", String(!show));
    bar.tabIndex = show ? 0 : -1;
    document.body.classList.toggle("has-apply-bar", show);
  };

  new IntersectionObserver(([e]) => { heroVisible = e.isIntersecting; update(); }, { threshold: 0.15 }).observe(hero);
  new IntersectionObserver(([e]) => { formVisible = e.isIntersecting; update(); }, { threshold: 0.05 }).observe(form);

  bar.addEventListener("click", (e) => {
    e.preventDefault();
    if (window.__mpLenis?.scrollTo) window.__mpLenis.scrollTo(form, { offset: -80 });
    else form.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
