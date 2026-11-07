// Все настройки бизнеса — через переменные окружения (можно менять в Railway без правки кода)

const num = (v, d) => (v !== undefined && v !== "" && !isNaN(Number(v)) ? Number(v) : d);

// Пакеты фото. Можно переопределить переменной PACKS_JSON, например:
// [{"id":"start","credits":20,"price":1200,"popular":false}, ...]  (price — в центах)
const DEFAULT_PACKS = [
  { id: "start", credits: 20, price: 1200 },
  { id: "pro", credits: 60, price: 2900, popular: true },
  { id: "agency", credits: 200, price: 7900 },
];

let PACKS = DEFAULT_PACKS;
if (process.env.PACKS_JSON) {
  try {
    PACKS = JSON.parse(process.env.PACKS_JSON);
  } catch (e) {
    console.error("PACKS_JSON не читается, используются пакеты по умолчанию:", e.message);
  }
}

const config = {
  PORT: num(process.env.PORT, 3000),
  DATABASE_URL: process.env.DATABASE_URL || "",
  FAL_KEY: process.env.FAL_KEY || "",
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  CURRENCY: (process.env.CURRENCY || "eur").toLowerCase(),
  FREE_CREDITS: num(process.env.FREE_CREDITS, 5), // бесплатные фото при регистрации
  REF_BONUS: num(process.env.REF_BONUS, 10), // бонус пригласившему после первой оплаты друга
  REF_WELCOME: num(process.env.REF_WELCOME, 3), // доп. бонус приглашённому при регистрации
  ADMIN_EMAILS: (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  PUBLIC_URL:
    process.env.PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : ""),
  BRAND: process.env.BRAND || "Realty Photo AI",
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || "",
  PACKS,
  // Данные владельца для Aviso legal (ст. 10 LSSI) и политики конфиденциальности (RGPD)
  LEGAL: {
    name: process.env.LEGAL_NAME || "", // ФИО (autónomo) или название компании
    nif: process.env.LEGAL_NIF || "", // NIF / NIE / CIF
    address: process.env.LEGAL_ADDRESS || "",
    email: process.env.LEGAL_EMAIL || process.env.SUPPORT_EMAIL || "",
    phone: process.env.LEGAL_PHONE || "",
    registry: process.env.LEGAL_REGISTRY || "", // данные Registro Mercantil (только для компаний)
    vatIncluded: process.env.PRICES_INCLUDE_VAT !== "0",
  },
  TERMS_VERSION: "2026-11-08",
};

// Стоимость обработки в кредитах (1 кредит = 1 фото)
config.costOf = ({ upscaleOnly, resolution }) => {
  if (upscaleOnly) return 1;
  return resolution === "4K" ? 2 : 1;
};

module.exports = config;
