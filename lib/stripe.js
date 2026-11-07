// Stripe через REST API (без SDK): Checkout + проверка подписи вебхука
const crypto = require("crypto");
const config = require("./config");

const STRIPE_API = process.env.STRIPE_API_BASE || "https://api.stripe.com";

function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join("&");
}

async function stripe(path, params) {
  const r = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formEncode(params),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Stripe: ${data?.error?.message || r.status}`);
  return data;
}

const PACK_NAMES = {
  ru: (n) => `${n} фото — ${config.BRAND}`,
  es: (n) => `${n} fotos — ${config.BRAND}`,
  en: (n) => `${n} photos — ${config.BRAND}`,
};

async function createCheckout({ user, pack, baseUrl }) {
  const lang = ["ru", "es", "en"].includes(user.lang) ? user.lang : "en";
  return stripe("/v1/checkout/sessions", {
    mode: "payment",
    client_reference_id: String(user.id),
    customer_email: user.email,
    success_url: `${baseUrl}/app?paid=1`,
    cancel_url: `${baseUrl}/app?canceled=1`,
    locale: lang === "ru" ? "auto" : lang,
    invoice_creation: { enabled: "true" }, // счёт (factura) для агентов — им нужно для расходов
    line_items: {
      0: {
        quantity: 1,
        price_data: {
          currency: config.CURRENCY,
          unit_amount: pack.price,
          product_data: { name: PACK_NAMES[lang](pack.credits) },
        },
      },
    },
    metadata: { user_id: String(user.id), pack: pack.id, credits: String(pack.credits) },
    payment_intent_data: { metadata: { user_id: String(user.id), pack: pack.id } },
  });
}

// Проверка подписи Stripe-Signature (t=...,v1=...)
function verifyWebhook(rawBody, header, secret = config.STRIPE_WEBHOOK_SECRET, toleranceSec = 300) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i), p.slice(i + 1)];
    })
  );
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  const expected = crypto.createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

module.exports = { createCheckout, verifyWebhook, formEncode };
