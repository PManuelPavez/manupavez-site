// shop.js — /shop.html: catálogo por secciones + checkout (MercadoPago o transferencia).
// Todo lo importante lo decide el servidor (mp-checkout): precio, cotización
// MEP, monto en ARS, el link de pago y los datos bancarios. Acá solo se muestra.
import { supabase, hasSupabase } from "../data/supabaseClient.js";
import { mountTurnstile } from "../features/turnstile.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const usd = (n) => `USD ${Number(n).toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
const ars = (n) => `$${Math.round(Number(n)).toLocaleString("es-AR")}`;

// Orden y textos de las secciones (la sección de cada producto se elige en el panel)
const SECTIONS = [
  { key: "mentorias", title: "Mentorías", lead: "Un mes dentro del laboratorio: sesiones 1:1, seguimiento y tu espacio de alumno." },
  { key: "clinicas", title: "Clínicas", lead: "Sesiones sueltas 1:1 para destrabar un track o una duda puntual." },
  { key: "mixmaster", title: "Mix & Master", lead: "Tus tracks listos para sonar en plataformas y en el club. Elegí cuántos." },
  { key: "otros", title: "Otros servicios", lead: "" },
];
const QUICK_QTY = [1, 3, 5, 10];

const root = $("[data-products]");
const tabs = $("[data-tabs]");
const banner = $("[data-banner]");
const dlg = $("[data-checkout]");
const form = $("[data-checkout-form]");
const transferPanel = $("[data-transfer]");
const note = $("[data-checkout-note]");
const payBtn = $("[data-pay]");
const qtyInput = form.elements.namedItem("quantity");

const ERRORS = {
  payments_not_configured: "Los pagos con MercadoPago se habilitan en breve. Mientras tanto, elegí transferencia o escribime a manupavez22@gmail.com.",
  transfer_not_configured: "La transferencia todavía no está habilitada. Elegí MercadoPago o escribime a manupavez22@gmail.com.",
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
let transferData = null;
const chosenQty = new Map(); // cantidad elegida en cada tarjeta (slug → n)

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

// Referencia en pesos (solo informativa: el monto real lo fija el servidor al pedir)
async function loadMep() {
  try {
    const res = await fetch("https://dolarapi.com/v1/dolares/bolsa", { cache: "no-store" });
    const v = Number((await res.json())?.venta);
    if (Number.isFinite(v) && v > 100) mep = v;
  } catch { /* sin referencia en pesos */ }
}

const qtyLabel = (p) => (p.unit === "track" ? "¿Cuántos tracks?" : "Cantidad");
const maxQty = (p) => Math.max(1, p.max_qty || 1);
const clampQty = (p, n) => Math.max(1, Math.min(maxQty(p), Math.floor(Number(n) || 1)));

function priceBlock(p, qty) {
  const total = p.price_usd * qty;
  return `
    <p class="shop-card__price">${usd(total)}${qty > 1 ? "" : ` <span>por ${esc(p.unit)}</span>`}</p>
    <p class="shop-card__ars">${qty > 1 ? `${qty} × ${usd(p.price_usd)}` : ""}${qty > 1 && mep ? " · " : ""}${mep ? `≈ ${ars(total * mep)} hoy` : ""}</p>`;
}

function renderCard(p, featured) {
  const qty = clampQty(p, chosenQty.get(p.slug) || 1);
  const multi = maxQty(p) > 1;
  const quick = QUICK_QTY.filter((n) => n <= maxQty(p));
  const tag = p.kind === "plan" ? `<span class="shop-card__tag">Acceso al Lab · 30 días</span>` : "";
  return `
    <article class="shop-card${featured ? " shop-card--featured" : ""}" id="p-${esc(p.slug)}" data-slug="${esc(p.slug)}" data-kind="${esc(p.kind)}">
      ${tag}
      <h3 class="shop-card__name">${esc(p.name)}</h3>
      ${p.description ? `<p class="shop-card__desc">${esc(p.description)}</p>` : ""}
      ${multi ? `
        <div class="shop-card__qty" role="group" aria-label="${esc(qtyLabel(p))}">
          <span class="shop-card__qty-label">${esc(qtyLabel(p))}</span>
          <div class="shop-chips">
            ${quick.map((n) => `<button type="button" class="shop-chip" data-qty="${n}" aria-pressed="${n === qty}">${n}</button>`).join("")}
            <div class="shop-stepper shop-stepper--sm">
              <button type="button" data-card-step="-1" aria-label="Uno menos">−</button>
              <output aria-live="polite">${qty}</output>
              <button type="button" data-card-step="1" aria-label="Uno más">+</button>
            </div>
          </div>
        </div>` : ""}
      <div class="shop-card__bottom">
        <div data-price>${priceBlock(p, qty)}</div>
        <button type="button" class="mp-btn ${p.kind === "plan" ? "primary" : "ghost"}" data-buy="${esc(p.slug)}">${multi && qty > 1 ? `COMPRAR ${qty}` : "COMPRAR"}</button>
      </div>
    </article>`;
}

function render() {
  const groups = SECTIONS
    .map((s) => ({ ...s, items: products.filter((p) => (SECTIONS.some((x) => x.key === p.category) ? p.category : "otros") === s.key) }))
    .filter((s) => s.items.length);
  if (!groups.length) {
    root.innerHTML = `<p class="muted">Pronto vas a encontrar acá las sesiones disponibles.</p>`;
    return;
  }
  root.innerHTML = groups.map((s, i) => `
    <section class="shop-section" id="${s.key}" data-section="${s.key}" aria-labelledby="sec-${s.key}">
      <header class="shop-section__head">
        <span class="shop-section__num">${String(i + 1).padStart(2, "0")}</span>
        <div>
          <h2 id="sec-${s.key}" class="shop-section__title">${esc(s.title)}</h2>
          ${s.lead ? `<p class="shop-section__lead">${esc(s.lead)}</p>` : ""}
        </div>
      </header>
      <div class="shop-grid${s.key === "mentorias" ? " shop-grid--featured" : ""}">
        ${s.items.map((p) => renderCard(p, s.key === "mentorias")).join("")}
      </div>
    </section>`).join("");
  tabs.innerHTML = groups.length > 1
    ? groups.map((s) => `<a class="shop-tab" href="#${s.key}">${esc(s.title)}</a>`).join("")
    : "";
  tabs.hidden = groups.length <= 1;
}

function setCardQty(card, n) {
  const p = products.find((x) => x.slug === card.dataset.slug);
  if (!p) return;
  const qty = clampQty(p, n);
  chosenQty.set(p.slug, qty);
  card.querySelectorAll("[data-qty]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.qty) === qty)));
  const out = card.querySelector("output");
  if (out) out.textContent = qty;
  $("[data-price]", card).innerHTML = priceBlock(p, qty);
  $("[data-buy]", card).textContent = qty > 1 ? `COMPRAR ${qty}` : "COMPRAR";
}

// ── Checkout ──
const method = () => form.elements.namedItem("method").value;

function updatePrice() {
  if (!current) return;
  const qty = clampQty(current, qtyInput.value);
  const total = current.price_usd * qty;
  $("[data-checkout-price]").textContent = usd(total);
  $("[data-checkout-ars]").textContent =
    `${qty > 1 ? `${qty} × ${usd(current.price_usd)}` : `por ${current.unit}`}${mep ? ` · ≈ ${ars(total * mep)} al MEP de hoy` : ""}`;
}

function updateMethod() {
  const transfer = method() === "transferencia";
  payBtn.textContent = transfer ? "VER DATOS PARA TRANSFERIR" : "PAGAR CON TARJETA";
  $("[data-checkout-legal]").textContent = transfer
    ? "Te muestro el alias y el CBU. El monto en pesos queda fijo al crear el pedido."
    : "El pago con tarjeta se hace en MercadoPago. El monto en pesos queda fijo al crear el pedido.";
}

async function openCheckout(slug) {
  current = products.find((p) => p.slug === slug);
  if (!current) return;
  form.hidden = false;
  transferPanel.hidden = true;
  $("[data-checkout-name]").textContent = current.name;
  $("[data-checkout-section]").textContent = SECTIONS.find((s) => s.key === current.category)?.title || "Tu compra";
  $("[data-qty-field]").hidden = maxQty(current) <= 1;
  $(".shop-qty__label").textContent = current.unit === "track" ? "Cantidad de tracks" : "Cantidad";
  qtyInput.max = maxQty(current);
  qtyInput.value = clampQty(current, chosenQty.get(slug) || 1);
  note.textContent = "";
  note.classList.remove("is-error");
  updatePrice();
  updateMethod();

  // Alumno logueado: su email ya viene cargado (y el pedido queda asociado a él)
  const { data } = await supabase.auth.getSession();
  const emailInput = form.elements.namedItem("email");
  if (data.session?.user?.email && !emailInput.value) emailInput.value = data.session.user.email;

  dlg.showModal();
  captcha ||= await mountTurnstile($("[data-captcha]"));
  (form.elements.namedItem("name").value ? emailInput : form.elements.namedItem("name")).focus();
}

function showTransfer(body) {
  transferData = body.transfer;
  const until = new Date(body.expires_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
  $("[data-t-code]").textContent = body.code;
  $("[data-t-code2]").textContent = body.code;
  $("[data-t-amount]").textContent = ars(body.amount_ars);
  $("[data-t-detail]").textContent = `${usd(body.price_usd)} al MEP ${Number(body.fx_mep).toLocaleString("es-AR")}`;
  $("[data-t-alias]").textContent = transferData.alias;
  $("[data-t-cbu]").textContent = transferData.cbu;
  $("[data-t-holder]").textContent = transferData.holder;
  $("[data-t-bank]").textContent = transferData.bank || "";
  $("[data-t-bank-row]").hidden = !transferData.bank;
  $("[data-t-until]").textContent = until;
  $("[data-t-mail]").href = `mailto:manupavez22@gmail.com?subject=${encodeURIComponent(`Comprobante pedido ${body.code}`)}`;
  $("[data-t-note]").textContent = "";
  form.hidden = true;
  transferPanel.hidden = false;
  transferPanel.focus();
}

root.addEventListener("click", (e) => {
  const card = e.target.closest(".shop-card");
  if (!card) return;
  const quick = e.target.closest("[data-qty]");
  if (quick) { setCardQty(card, quick.dataset.qty); return; }
  const step = e.target.closest("[data-card-step]");
  if (step) { setCardQty(card, (chosenQty.get(card.dataset.slug) || 1) + Number(step.dataset.cardStep)); return; }
  const btn = e.target.closest("[data-buy]");
  if (btn) openCheckout(btn.dataset.buy);
});

dlg.addEventListener("click", async (e) => {
  if (e.target.closest("[data-close]")) { dlg.close(); return; }
  const step = e.target.closest("[data-step]");
  if (step && current) {
    qtyInput.value = clampQty(current, Number(qtyInput.value) + Number(step.dataset.step));
    chosenQty.set(current.slug, Number(qtyInput.value));
    updatePrice();
    return;
  }
  const copy = e.target.closest("[data-copy-field]");
  if (copy && transferData) {
    try {
      await navigator.clipboard.writeText(transferData[copy.dataset.copyField]);
      copy.textContent = "COPIADO ✓";
      setTimeout(() => { copy.textContent = "COPIAR"; }, 1800);
    } catch {
      $("[data-t-note]").textContent = "No se pudo copiar: seleccioná el texto y copialo a mano.";
    }
  }
});
form.addEventListener("input", (e) => {
  if (e.target.name === "quantity" && current) { chosenQty.set(current.slug, clampQty(current, qtyInput.value)); updatePrice(); }
  if (e.target.name === "method") updateMethod();
});
// Al cerrar, la tarjeta refleja la cantidad que quedó en el checkout
dlg.addEventListener("close", () => {
  const card = current && root.querySelector(`.shop-card[data-slug="${CSS.escape(current.slug)}"]`);
  if (card && maxQty(current) > 1) setCardQty(card, chosenQty.get(current.slug) || 1);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!current) return;
  const f = form.elements;
  const name = f.namedItem("name").value.trim();
  const email = f.namedItem("email").value.trim();
  const say = (text, isError = true) => { note.textContent = text; note.classList.toggle("is-error", isError); };
  if (name.length < 2) { say(ERRORS.invalid_name); f.namedItem("name").focus(); return; }
  if (!f.namedItem("email").checkValidity() || !email) { say(ERRORS.invalid_email); f.namedItem("email").focus(); return; }

  const chosen = method();
  payBtn.disabled = true;
  say(chosen === "transferencia" ? "Preparando tu pedido…" : "Preparando tu pago…", false);
  try {
    const { data } = await supabase.auth.getSession();
    const headers = { "Content-Type": "application/json" };
    if (data.session) headers.Authorization = `Bearer ${data.session.access_token}`;
    const res = await fetch(`${window.MP_SUPABASE.url}/functions/v1/mp-checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        product: current.slug,
        quantity: clampQty(current, qtyInput.value),
        name,
        email,
        method: chosen,
        captcha: captcha ? await captcha.getToken() : "",
      }),
    });
    const body = await res.json().catch(() => ({}));
    captcha?.reset();
    if (res.ok && chosen === "transferencia" && body.transfer?.alias) {
      say("", false);
      showTransfer(body);
      return;
    }
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
    root.innerHTML = `<p class="muted">El shop no está disponible en este momento.</p>`;
    return;
  }
  const [{ data, error }] = await Promise.all([
    supabase.from("products").select("slug, name, description, kind, category, price_usd, unit, max_qty").order("sort"),
    loadMep(),
  ]);
  if (error) throw error;
  products = (data || []).filter((p) => p.price_usd);
  render();
  openFromLink();
}

// Link directo a un paquete (para landings): shop.html?comprar=<slug>[&cantidad=3]
// Lleva a su tarjeta y abre el checkout. Los parámetros se limpian de la URL.
function openFromLink() {
  const params = new URLSearchParams(location.search);
  const slug = params.get("comprar");
  if (!slug) return;
  params.delete("comprar");
  const qty = params.get("cantidad");
  params.delete("cantidad");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : "") + location.hash);

  const p = products.find((x) => x.slug === slug);
  if (!p) {
    banner.textContent = "Ese servicio no está disponible en este momento. Mirá las opciones de abajo o escribime.";
    banner.dataset.tone = "pendiente";
    banner.hidden = false;
    return;
  }
  if (qty) chosenQty.set(p.slug, clampQty(p, qty));
  const card = document.getElementById(`p-${p.slug}`);
  if (card) {
    if (maxQty(p) > 1) setCardQty(card, chosenQty.get(p.slug) || 1);
    card.scrollIntoView({ block: "center" });
    card.classList.add("is-linked");
  }
  openCheckout(p.slug);
}

boot().catch((err) => {
  console.error("[shop]", err);
  root.innerHTML = `<p class="muted">No se pudo cargar el shop. Probá recargando la página.</p>`;
});
