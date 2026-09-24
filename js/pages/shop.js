// shop.js — /shop.html: catálogo + checkout con MercadoPago.
// Todo lo importante lo decide el servidor (mp-checkout): precio, cotización
// MEP, monto en ARS y el link de pago. Acá solo se muestra y se redirige.
import { supabase, hasSupabase } from "../data/supabaseClient.js";
import { mountTurnstile } from "../features/turnstile.js";

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (n) => `USD ${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const ars = (n) => `$${Math.round(Number(n)).toLocaleString("es-AR")}`;

const grid = $("[data-products]");
const banner = $("[data-banner]");
const dlg = $("[data-checkout]");
const form = $("[data-checkout-form]");
const note = $("[data-checkout-note]");
const payBtn = $("[data-pay]");

const ERRORS = {
  payments_not_configured: "Los pagos online se habilitan en breve. Mientras tanto, escribime a manupavez22@gmail.com y lo coordinamos.",
  captcha: "No pudimos verificar que no sos un robot. Esperá un segundo y probá de nuevo.",
  invalid_name: "Escribí tu nombre.",
  invalid_email: "Revisá tu email.",
  invalid_quantity: "Revisá la cantidad.",
  too_many_orders: "Ya generaste varios pedidos seguidos. Revisá tu mail o escribime.",
  fx_unavailable: "No pude obtener el dólar MEP ahora. Probá en un minuto.",
  product_not_available: "Este servicio no está disponible en este momento.",
};

let products = [];
let mep = null;
let current = null;
let captcha = null;

// Vuelta desde MercadoPago
function showReturnBanner() {
  const estado = new URLSearchParams(location.search).get("pago");
  const text = {
    ok: "¡Listo! Recibimos tu pago. Te escribo en breve para coordinar. Si compraste la mentoría, tu acceso ya está activo.",
    pendiente: "Tu pago quedó pendiente. Apenas MercadoPago lo confirme te llega el aviso.",
    error: "El pago no se completó. Podés intentarlo de nuevo cuando quieras.",
  }[estado];
  if (!text) return;
  banner.textContent = text;
  banner.dataset.tone = estado;
  banner.hidden = false;
  history.replaceState(null, "", location.pathname); // que no quede en el historial
}

// Referencia en pesos (solo informativa: el monto real lo fija el servidor al pagar)
async function loadMep() {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/bolsa", { cache: "no-store" });
    const v = Number((await res.json())?.venta);
    if (Number.isFinite(v) && v > 100) mep = v;
  } catch { /* sin referencia en pesos */ }
}

function renderProduct(p) {
  const approx = mep ? `<p class="shop-card__ars">≈ ${ars(p.price_usd * mep)} hoy (MEP)</p>` : "";
  return `
    <article class="shop-card" data-kind="${esc(p.kind)}">
      <h2 class="shop-card__name">${esc(p.name)}</h2>
      ${p.description ? `<p class="shop-card__desc">${esc(p.description)}</p>` : ""}
      <div class="shop-card__bottom">
        <p class="shop-card__price">${usd(p.price_usd)} <span>por ${esc(p.unit)}</span></p>
        ${approx}
        <button type="button" class="mp-btn ${p.kind === "plan" ? "primary" : "ghost"}" data-buy="${esc(p.slug)}">COMPRAR</button>
      </div>
    </article>`;
}

function updatePrice() {
  if (!current) return;
  const qty = Math.max(1, Math.min(current.max_qty || 1, Number(form.elements.namedItem("quantity").value) || 1));
  const total = current.price_usd * qty;
  $("[data-checkout-price]").textContent =
    `${usd(total)}${mep ? ` · ≈ ${ars(total * mep)}` : ""}${qty > 1 ? ` (${qty} × ${usd(current.price_usd)})` : ""}`;
}

async function openCheckout(slug) {
  current = products.find((p) => p.slug === slug);
  if (!current) return;
  $("[data-checkout-name]").textContent = current.name;
  const qtyField = $("[data-qty-field]");
  qtyField.hidden = (current.max_qty || 1) <= 1;
  form.elements.namedItem("quantity").max = current.max_qty || 1;
  form.elements.namedItem("quantity").value = 1;
  note.textContent = "";
  note.classList.remove("is-error");
  updatePrice();

  // Alumno logueado: su email ya viene cargado (y el pedido queda asociado a él)
  const { data } = await supabase.auth.getSession();
  const emailInput = form.elements.namedItem("email");
  if (data.session?.user?.email && !emailInput.value) emailInput.value = data.session.user.email;

  dlg.showModal();
  captcha ||= await mountTurnstile($("[data-captcha]"));
  (form.elements.namedItem("name").value ? emailInput : form.elements.namedItem("name")).focus();
}

grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-buy]");
  if (btn) openCheckout(btn.dataset.buy);
});
$("[data-close]").addEventListener("click", () => dlg.close());
form.addEventListener("input", (e) => { if (e.target.name === "quantity") updatePrice(); });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!current) return;
  const f = form.elements;
  const name = f.namedItem("name").value.trim();
  const email = f.namedItem("email").value.trim();
  const say = (text, isError = true) => { note.textContent = text; note.classList.toggle("is-error", isError); };
  if (name.length < 2) { say(ERRORS.invalid_name); f.namedItem("name").focus(); return; }
  if (!f.namedItem("email").checkValidity() || !email) { say(ERRORS.invalid_email); f.namedItem("email").focus(); return; }

  payBtn.disabled = true;
  say("Preparando tu pago…", false);
  try {
    const { data } = await supabase.auth.getSession();
    const headers = { "Content-Type": "application/json" };
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
    const res = await fetch(`${window.MP_SUPABASE.url}/functions/v1/mp-checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        product: current.slug,
        quantity: Number(f.namedItem("quantity").value || 1),
        name,
        email,
        captcha: captcha ? await captcha.getToken() : "",
      }),
    });
    const body = await res.json().catch(() => ({}));
    captcha?.reset();
    // Solo se redirige a MercadoPago (nunca a una URL arbitraria)
    const target = String(body.init_point || "");
    if (res.ok && /^https:\/\/([a-z0-9-]+\.)*mercadopago\.com(\.[a-z]{2})?\//i.test(target)) {
      say("Te llevamos a MercadoPago…", false);
      location.href = target;
      return;
    }
    say(ERRORS[body.error] || "No se pudo iniciar el pago. Probá de nuevo en un momento.");
  } catch {
    say("Sin conexión. Revisá tu internet y probá de nuevo.");
  } finally {
    payBtn.disabled = false;
  }
});

async function boot() {
  showReturnBanner();
  if (!hasSupabase() || !supabase) {
    grid.innerHTML = `<p class="muted">El shop no está disponible en este momento.</p>`;
    return;
  }
  const [{ data, error }] = await Promise.all([
    supabase.from("products").select("slug, name, description, kind, price_usd, unit, max_qty").order("sort"),
    loadMep(),
  ]);
  if (error) throw error;
  products = (data || []).filter((p) => p.price_usd);
  grid.innerHTML = products.length
    ? products.map(renderProduct).join("")
    : `<p class="muted">Pronto vas a encontrar acá las sesiones disponibles.</p>`;
}

boot().catch((err) => {
  console.error("[shop]", err);
  grid.innerHTML = `<p class="muted">No se pudo cargar el shop. Probá recargando la página.</p>`;
});
