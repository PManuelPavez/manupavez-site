// pergamino.js — venta de entradas del evento (página /pergamino).
// Lee la info pública con la RPC public_event (sin vendidas ni datos personales) y compra con la
// Edge Function tickets-checkout, que reserva el stock 15 min y devuelve el link de MercadoPago.
// ?rrpp=CODIGO se guarda 7 días en este navegador.

import { mountTurnstile } from "../features/turnstile.js";

const SLUG = "pergamino";
const MAX_QTY = 6;
const RRPP_KEY = "pg_rrpp";
const RRPP_DAYS = 7;

const cfg = window.MP_SUPABASE;
const $ = (s, el = document) => el.querySelector(s);
const ars = (n) => `$${Math.round(n).toLocaleString("es-AR")}`;

const ERRORS = {
  captcha: "No pudimos verificar que no sos un robot. Probá de nuevo.",
  invalid_email: "Revisá el mail.",
  invalid_phone: "Revisá el teléfono (con código de área).",
  invalid_name: "Revisá tu nombre y apellido.",
  invalid_attendees: "Completá nombre y apellido de cada entrada.",
  invalid_quantity: "Elegí entre 1 y 6 entradas.",
  too_many_orders: "Tenés varios pedidos sin pagar. Esperá unos minutos y probá de nuevo.",
  sold_out: "Se agotaron las entradas mientras completabas.",
  mp_failed: "MercadoPago no respondió. Probá de nuevo en un rato.",
  payments_not_configured: "La venta todavía no está habilitada.",
};

// ---------- RRPP: ?rrpp=CODIGO → 7 días ----------
function readRrpp() {
  const fromUrl = new URLSearchParams(location.search).get("rrpp");
  const valid = (c) => /^[A-Za-z0-9]{2,20}$/.test(c || "");
  if (valid(fromUrl)) {
    try { localStorage.setItem(RRPP_KEY, JSON.stringify({ code: fromUrl.toUpperCase(), exp: Date.now() + RRPP_DAYS * 86400_000 })); } catch {}
    return fromUrl.toUpperCase();
  }
  try {
    const saved = JSON.parse(localStorage.getItem(RRPP_KEY) || "null");
    if (saved && valid(saved.code) && saved.exp > Date.now()) return saved.code;
  } catch {}
  return "";
}

async function rpc(fn, args) {
  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc_${res.status}`);
  return res.json();
}

async function callCheckout(payload) {
  const res = await fetch(`${cfg.url}/functions/v1/tickets-checkout`, {
    method: "POST",
    headers: { apikey: cfg.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ event: SLUG, ...payload }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const dateLong = (d) => {
  const s = new Date(`${d}T12:00:00-03:00`).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// ---------- Info del evento ----------
function renderEvent(ev) {
  $("[data-name]").textContent = ev.name;
  $("[data-date]").textContent = dateLong(ev.event_date);
  $("[data-time]").textContent = ev.time_text || "A confirmar";
  $("[data-venue]").textContent = ev.venue || "A confirmar";
  $("[data-address]").textContent = ev.address || "A confirmar";

  if (Array.isArray(ev.lineup) && ev.lineup.length) {
    const ul = $("[data-lineup]");
    ul.replaceChildren(...ev.lineup.map((a) => {
      const li = document.createElement("li");
      li.innerHTML = `<span class="pg-lineup__role"></span><span class="pg-lineup__name"></span>`;
      li.firstChild.textContent = a.role || "";
      li.lastChild.textContent = a.name;
      return li;
    }));
  }

  if (ev.flyer_url) {
    const img = new Image();
    img.alt = `Flyer: ${ev.name}`;
    img.decoding = "async";
    img.onload = () => $("[data-flyer]").replaceChildren(img);
    img.src = ev.flyer_url;
  }
}

function renderTiers(ev) {
  const cur = ev.current;
  $("[data-tier-name]").textContent = cur.name;
  $("[data-tier-price]").textContent = ars(cur.price_ars);
  $("[data-tier-left]").textContent = cur.left === 1 ? "Queda 1 en esta tanda" : `Quedan ${cur.left} en esta tanda`;
  const list = $("[data-tiers]");
  list.replaceChildren(...(ev.tiers || []).map((t) => {
    const li = document.createElement("li");
    li.className = `pg-tiers__item is-${t.state}`;
    const label = { current: "A la venta", soldout: "Agotada", next: "Próxima" }[t.state];
    li.innerHTML = `<span></span><span></span><span class="pg-tiers__state"></span>`;
    li.children[0].textContent = t.name;
    li.children[1].textContent = ars(t.price_ars);
    li.children[2].textContent = label;
    return li;
  }));
}

// ---------- Formulario de compra ----------
function setupBuy(ev, rrpp) {
  const form = $("[data-buy]");
  const people = $("[data-people]");
  const maxQty = Math.max(1, Math.min(MAX_QTY, ev.current.left));
  let qty = 1;
  let firstTouched = false; // si la persona edita la entrada 1, no se pisa con sus datos
  let captcha = null;

  form.rrpp.value = rrpp;

  const personRow = (i) => {
    const row = document.createElement("div");
    row.className = "pg-person";
    row.innerHTML = `<span class="pg-person__n">${i + 1}</span>
      <label><span class="pg-sr">Nombre entrada ${i + 1}</span><input name="p_first_${i}" placeholder="Nombre" autocomplete="off" required maxlength="60" /></label>
      <label><span class="pg-sr">Apellido entrada ${i + 1}</span><input name="p_last_${i}" placeholder="Apellido" autocomplete="off" required maxlength="60" /></label>`;
    if (i === 0) row.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => { firstTouched = true; }));
    return row;
  };

  const syncFirst = () => {
    if (firstTouched) return;
    form.p_first_0.value = form.first_name.value;
    form.p_last_0.value = form.last_name.value;
  };

  const renderQty = () => {
    while (people.children.length < qty) people.appendChild(personRow(people.children.length));
    while (people.children.length > qty) people.lastElementChild.remove();
    $("[data-qty-n]").textContent = qty;
    $("[data-total]").textContent = `Total ${ars(ev.current.price_ars * qty)}`;
    form.querySelector('[data-qty="-1"]').disabled = qty <= 1;
    form.querySelector('[data-qty="1"]').disabled = qty >= maxQty;
    $("[data-submit]").textContent = `Pagar ${ars(ev.current.price_ars * qty)} con Mercado Pago`;
  };

  form.querySelectorAll("[data-qty]").forEach((b) => b.addEventListener("click", () => {
    qty = Math.min(maxQty, Math.max(1, qty + Number(b.dataset.qty)));
    renderQty();
  }));
  form.first_name.addEventListener("input", syncFirst);
  form.last_name.addEventListener("input", syncFirst);
  renderQty();
  syncFirst();

  // Turnstile se monta cuando la persona empieza a completar (no frena la carga)
  form.addEventListener("focusin", async () => { captcha ||= await mountTurnstile($("[data-captcha]")); }, { once: true });

  const err = $("[data-error]");
  const showErr = (msg) => { err.textContent = msg; err.hidden = !msg; if (msg) err.scrollIntoView({ block: "center", behavior: "smooth" }); };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showErr("");
    const v = (n) => form[n].value.trim();
    const attendees = [...Array(qty)].map((_, i) => ({ first_name: v(`p_first_${i}`), last_name: v(`p_last_${i}`) }));
    if (!v("first_name") || !v("last_name")) return showErr(ERRORS.invalid_name);
    if (v("phone").replace(/\D/g, "").length < 8) return showErr(ERRORS.invalid_phone);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("email"))) return showErr(ERRORS.invalid_email);
    if (attendees.some((a) => !a.first_name || !a.last_name)) return showErr(ERRORS.invalid_attendees);

    const btn = $("[data-submit]");
    btn.disabled = true;
    btn.textContent = "Reservando tus entradas…";
    try {
      captcha ||= await mountTurnstile($("[data-captcha]"));
      const { body } = await callCheckout({
        action: "buy", tier_id: ev.current.id, quantity: qty,
        first_name: v("first_name"), last_name: v("last_name"), phone: v("phone"), email: v("email"),
        rrpp: v("rrpp"), attendees, fans: form.fans.checked, captcha: await captcha.getToken(),
      });
      if (body.init_point) {
        btn.textContent = "Abriendo Mercado Pago…";
        location.href = body.init_point;
        return;
      }
      if (body.error === "tier_changed") {
        showErr(`Cambió la tanda: ahora es ${body.tier} a ${ars(body.price_ars)}. Actualizamos el precio, revisalo y volvé a tocar Pagar.`);
        await reload();
      } else if (body.error === "not_enough") {
        showErr(body.left > 0 ? `Quedan ${body.left} en esta tanda. Bajá la cantidad.` : ERRORS.sold_out);
        await reload();
      } else {
        showErr(ERRORS[body.error] || "Algo falló. Probá de nuevo.");
      }
    } catch {
      showErr("No hay conexión. Probá de nuevo.");
    } finally {
      captcha?.reset();
      btn.disabled = false;
      if (!btn.textContent.startsWith("Abriendo")) renderQty();
    }
  });

  // Recarga la tanda sin perder lo que la persona ya escribió
  async function reload() {
    const fresh = await rpc("public_event", { p_slug: SLUG }).catch(() => null);
    if (!fresh?.current) return location.reload();
    ev.current = fresh.current;
    ev.tiers = fresh.tiers;
    renderTiers(ev);
    qty = Math.min(qty, Math.max(1, Math.min(MAX_QTY, ev.current.left)));
    renderQty();
  }
}

// ---------- Lista de espera ----------
function setupWaitlist() {
  const form = $("[data-wait]");
  let captcha = null;
  form.addEventListener("focusin", async () => { captcha ||= await mountTurnstile($("[data-captcha-wait]")); }, { once: true });
  const err = $("[data-wait-error]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = (n) => form[n].value.trim();
    err.hidden = true;
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    if (v("name").length < 2) return fail("Completá tu nombre.");
    if (v("phone").replace(/\D/g, "").length < 8) return fail(ERRORS.invalid_phone);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v("email"))) return fail(ERRORS.invalid_email);
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      captcha ||= await mountTurnstile($("[data-captcha-wait]"));
      const { body } = await callCheckout({ action: "waitlist", name: v("name"), phone: v("phone"), email: v("email"), fans: form.fans.checked, captcha: await captcha.getToken() });
      if (body.ok) {
        form.replaceWith(Object.assign(document.createElement("p"), { className: "pg-ok", textContent: "¡Listo! Te avisamos apenas haya entradas." }));
        return;
      }
      if (body.error === "on_sale") return location.reload();
      fail(ERRORS[body.error] || "Algo falló. Probá de nuevo.");
    } catch {
      fail("No hay conexión. Probá de nuevo.");
    } finally {
      captcha?.reset();
      btn.disabled = false;
    }
  });
}

// ---------- Vuelta de MercadoPago ----------
async function showReturn(orderId, estado) {
  const box = $("[data-result]");
  box.hidden = false;
  const paint = (title, text, cls) => {
    box.className = `pg-card pg-result ${cls || ""}`;
    box.innerHTML = `<h2 class="pg-h2"></h2><p></p>`;
    box.firstChild.textContent = title;
    box.lastChild.textContent = text;
  };
  if (estado === "error") {
    paint("El pago no se completó", "No se cobró nada. Podés intentarlo de nuevo más abajo.", "is-bad");
    return;
  }
  paint("Confirmando tu pago…", "Esto tarda unos segundos.");
  for (let i = 0; i < 20; i++) {
    const st = await rpc("ticket_order_status", { p_order_id: orderId }).catch(() => null);
    if (st?.status === "approved") {
      paint("¡Estás en la lista!", `${st.quantity === 1 ? "Tu entrada está confirmada" : `Tus ${st.quantity} entradas están confirmadas`}. Te mandamos un mail con los datos. Presentá tu DNI en la puerta.`, "is-ok");
      return true;
    }
    if (st?.status === "rejected" || st?.status === "expired") {
      paint("El pago no se completó", "No se cobró nada. Podés intentarlo de nuevo más abajo.", "is-bad");
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  paint("Tu pago está en proceso", "Cuando MercadoPago lo apruebe te llega un mail de confirmación. Si no te llega en un rato, escribinos por Instagram.");
}

// ---------- Inicio ----------
(async function init() {
  const rrpp = readRrpp();
  const q = new URLSearchParams(location.search);
  const orderId = q.get("orden");
  const paid = /^[0-9a-f-]{36}$/i.test(orderId || "") ? showReturn(orderId, q.get("pago")) : null;

  let ev = null;
  try { ev = await rpc("public_event", { p_slug: SLUG }); } catch {}
  $("[data-loading]").hidden = true;
  if (!ev) {
    $("[data-loading]").hidden = false;
    $("[data-loading]").textContent = "No pudimos cargar las entradas. Recargá la página.";
    return;
  }
  renderEvent(ev);

  // Si acaba de comprar, no le mostramos el formulario hasta saber cómo salió el pago
  if (paid && (await paid)) return;

  if (ev.current) {
    renderTiers(ev);
    $("[data-sale]").hidden = false;
    setupBuy(ev, rrpp);
  } else {
    $("[data-waitlist]").hidden = false;
    setupWaitlist();
  }
})();
