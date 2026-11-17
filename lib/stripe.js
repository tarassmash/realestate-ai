// Stripe через REST API (без SDK): Checkout, автонастройка вебхука, возвраты, проверка подписи
const crypto = require("crypto");
const config = require("./config");
const db = require("./db");

const STRIPE_API = process.env.STRIPE_API_BASE || "https://api.stripe.com";
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "charge.refunded",
];

function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === "object" ? formEncode(item, `${key}[${i}]`, out) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`)));
    else if (typeof v === "object") formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out.join("&");
}

async function request(method, path, params) {
  const isGet = method === "GET" || method === "DELETE";
  const qs = isGet && params ? "?" + formEncode(params) : "";
  const r = await fetch(`${STRIPE_API}${path}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: isGet ? undefined : formEncode(params || {}),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(`Stripe: ${data?.error?.message || r.status}`);
    e.stripe = data?.error;
    e.status = r.status;
    throw e;
  }
  return data;
}

const mode = () => (/^(sk|rk)_live_/.test(config.STRIPE_SECRET_KEY) ? "live" : "test");

// ---------- настройки в БД ----------
async function getSetting(key) {
  const { rows } = await db.q("SELECT value FROM settings WHERE key=$1", [key]);
  return rows[0]?.value ?? null;
}
async function setSetting(key, value) {
  await db.q(
    `INSERT INTO settings(key, value, updated_at) VALUES ($1,$2,now())
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`,
    [key, value]
  );
}

// Секрет вебхука: из переменной окружения или созданный автоматически (хранится в БД)
async function getWebhookSecret() {
  if (config.STRIPE_WEBHOOK_SECRET) return config.STRIPE_WEBHOOK_SECRET;
  return getSetting(`stripe_whsec_${mode()}`);
}

// ---------- автонастройка ----------
let status = { configured: false };

async function ensureSetup(baseUrl) {
  if (!config.STRIPE_SECRET_KEY) return (status = { configured: false, error: "STRIPE_SECRET_KEY не задан" });
  const st = { configured: true, mode: mode(), checkedAt: new Date().toISOString() };
  try {
    const acc = await request("GET", "/v1/account");
    st.account = {
      id: acc.id,
      name: acc.settings?.dashboard?.display_name || acc.business_profile?.name || acc.email || acc.id,
      country: acc.country,
      chargesEnabled: !!acc.charges_enabled,
      detailsSubmitted: !!acc.details_submitted,
    };
  } catch (e) {
    st.error = e.message;
    return (status = st);
  }

  const url = baseUrl ? `${baseUrl.replace(/\/$/, "")}/api/stripe/webhook` : "";
  if (config.STRIPE_WEBHOOK_SECRET) {
    st.webhook = { source: "env", url };
  } else if (!/^https:\/\//.test(url) && !process.env.STRIPE_API_BASE) {
    st.webhook = { source: "none", url };
    st.warning = "Нет публичного https-адреса (PUBLIC_URL) — вебхук не создан";
  } else {
    try {
      const key = `stripe_whsec_${st.mode}`, idKey = `stripe_whid_${st.mode}`;
      const [secret, savedId] = [await getSetting(key), await getSetting(idKey)];
      const list = await request("GET", "/v1/webhook_endpoints", { limit: 100 });
      const ours = (list.data || []).filter((w) => w.url === url);
      let ep = ours.find((w) => w.id === savedId);
      if (ep && secret) {
        // уже настроен — обновим список событий и включим, если выключен
        const missing = WEBHOOK_EVENTS.some((ev) => !(ep.enabled_events || []).includes(ev));
        if (missing || ep.status !== "enabled") ep = await request("POST", `/v1/webhook_endpoints/${ep.id}`, { enabled_events: WEBHOOK_EVENTS, disabled: false });
      } else {
        // секрета у нас нет — пересоздаём (секрет Stripe отдаёт только при создании)
        for (const w of ours) await request("DELETE", `/v1/webhook_endpoints/${w.id}`).catch(() => {});
        ep = await request("POST", "/v1/webhook_endpoints", {
          url,
          enabled_events: WEBHOOK_EVENTS,
          description: `${config.BRAND} (auto)`,
        });
        await setSetting(key, ep.secret);
        await setSetting(idKey, ep.id);
      }
      st.webhook = { source: "auto", url, id: ep.id, status: ep.status };
    } catch (e) {
      st.webhook = { source: "error", url };
      st.error = "Вебхук: " + e.message;
    }
  }
  st.lastEventAt = await getSetting("stripe_last_event_at");
  st.ok = !st.error && st.account?.chargesEnabled && ["auto", "env"].includes(st.webhook?.source);
  return (status = st);
}
const getStatus = async () => ({ ...status, lastEventAt: await getSetting("stripe_last_event_at").catch(() => null) });

// ---------- Checkout ----------
const PACK_NAMES = {
  ru: (n) => `${n} фото — ${config.BRAND}`,
  es: (n) => `${n} fotos — ${config.BRAND}`,
  en: (n) => `${n} photos — ${config.BRAND}`,
};

// Подтверждение на «долговечном носителе» (ст. 98.7 TRLGDCU) — текст попадает на страницу оплаты
const CHECKOUT_NOTE = {
  ru: (u) => `Вы согласились с Условиями (${u}/condiciones) и попросили начать оказание услуги сразу. Неиспользованные кредиты можно вернуть в течение 14 дней.`,
  es: (u) => `Has aceptado las Condiciones (${u}/condiciones) y solicitado el inicio inmediato del servicio. Puedes desistir de los créditos no usados en 14 días.`,
  en: (u) => `You accepted the Terms (${u}/condiciones) and requested immediate start of the service. Unused credits can be refunded within 14 days.`,
};

async function createCheckout({ user, pack, baseUrl }) {
  const lang = ["ru", "es", "en"].includes(user.lang) ? user.lang : "en";
  const params = {
    mode: "payment",
    client_reference_id: String(user.id),
    customer_email: user.email,
    // {CHECKOUT_SESSION_ID} Stripe подставит сам — по нему начисляем кредиты сразу после возврата
    success_url: `${baseUrl}/app?paid=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/app?canceled=1`,
    locale: lang === "ru" ? "auto" : lang,
    allow_promotion_codes: "true", // промокоды из Stripe Dashboard
    customer_creation: "always",
    invoice_creation: {
      enabled: "true", // счёт (factura) — агентам нужен для расходов
      invoice_data: { description: PACK_NAMES[lang](pack.credits), footer: config.LEGAL.name ? `${config.LEGAL.name} · NIF ${config.LEGAL.nif || ""}` : undefined },
    },
    tax_id_collection: { enabled: "true" }, // клиент может указать свой NIF/CIF в счёте
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: config.CURRENCY,
          unit_amount: pack.price,
          product_data: { name: PACK_NAMES[lang](pack.credits) },
          ...(config.STRIPE_AUTOMATIC_TAX ? { tax_behavior: config.LEGAL.vatIncluded ? "inclusive" : "exclusive" } : {}),
        },
      },
    ],
    custom_text: { submit: { message: CHECKOUT_NOTE[lang](baseUrl) } },
    metadata: {
      user_id: String(user.id), pack: pack.id, credits: String(pack.credits),
      terms_version: config.TERMS_VERSION, consent_at: new Date().toISOString(),
    },
    payment_intent_data: { metadata: { user_id: String(user.id), pack: pack.id, credits: String(pack.credits) } },
  };
  if (config.STRIPE_AUTOMATIC_TAX) {
    params.automatic_tax = { enabled: "true" };
    params.billing_address_collection = "required";
  }
  try {
    return await request("POST", "/v1/checkout/sessions", params);
  } catch (e) {
    // если в аккаунте не включены налоговые ID — пробуем без них, чтобы оплата не ломалась
    if (e.status === 400 && /tax_id_collection/.test(e.message)) {
      delete params.tax_id_collection;
      return request("POST", "/v1/checkout/sessions", params);
    }
    throw e;
  }
}

// Полная сессия с чеком и счётом
const retrieveSession = (id) =>
  request("GET", `/v1/checkout/sessions/${encodeURIComponent(id)}`, { expand: ["payment_intent.latest_charge", "invoice"] });

const refund = (paymentIntent, amount, metadata) =>
  request("POST", "/v1/refunds", { payment_intent: paymentIntent, amount, reason: "requested_by_customer", metadata });

// Проверка подписи Stripe-Signature (t=...,v1=...)
function verifyWebhook(rawBody, header, secret, toleranceSec = 300) {
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

module.exports = {
  createCheckout, retrieveSession, refund, verifyWebhook, formEncode,
  ensureSetup, getStatus, getWebhookSecret, setSetting, mode, WEBHOOK_EVENTS,
};
