// Общие функции: переводы, API, окно входа/регистрации, окно тарифов
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};
const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------------- Переводы ----------------
const I18N = {
  ru: {
    // общее
    login: "Войти", signup: "Регистрация", logout: "Выйти", openApp: "Открыть приложение", tryFree: "Попробовать бесплатно",
    email: "Email", password: "Пароль", passwordHint: "Минимум 8 символов", createAccount: "Создать аккаунт", signIn: "Войти",
    authTitleIn: "С возвращением", authTitleUp: "Начните бесплатно",
    authSubIn: "Войдите, чтобы продолжить", authSubUp: "Без карты. Займёт 20 секунд.",
    gift: (n) => `🎁 ${n} фото бесплатно после регистрации`, giftRef: (n) => `+${n} фото от коллеги, который вас пригласил`,
    terms: "Регистрируясь, вы соглашаетесь с условиями сервиса.",
    photos: (n) => `${n} ${plural(n, "фото", "фото", "фото")}`, credits: (n) => `${n} ${plural(n, "кредит", "кредита", "кредитов")}`,
    balance: "Баланс", topUp: "Пополнить",
    pricingTitle: "Пакеты фото", pricingSub: "Платите только за обработанные фото. Без подписки — кредиты не сгорают.",
    pack_start: "Старт", pack_pro: "Профи", pack_agency: "Агентство", popular: "Популярный",
    perPhoto: (p) => `${p} за фото`, buy: "Купить", freeName: "Бесплатно", freeCredits: (n) => `${n} фото`, freeCta: "Начать",
    f_all: "Все инструменты", f_hd: "До 4K и апскейл", f_noexp: "Кредиты не сгорают", f_invoice: "Счёт (factura) для бухгалтерии", f_priority: "Для команды агентства",
    f_nocard: "Без карты", f_try: "Попробуйте на своих объектах",
    costNote: "1 фото = 1 кредит · 4K = 2 кредита · апскейл бесплатно",
    payOff: "Оплата скоро будет доступна. Напишите нам, чтобы пополнить баланс.",
    paid: "Оплата прошла — кредиты начислены 🎉", canceled: "Оплата отменена",
    // ошибки
    e_bad_email: "Проверьте email", e_short_password: "Пароль — минимум 8 символов", e_too_many: "Слишком много попыток, попробуйте позже",
    e_email_taken: "Этот email уже зарегистрирован — войдите", e_bad_login: "Неверный email или пароль", e_blocked: "Аккаунт заблокирован",
    e_no_credits: "Недостаточно кредитов — пополните баланс", e_not_configured: "Сервис временно недоступен", e_payments_off: "Оплата временно недоступна",
    e_bad_image: "Не удалось прочитать фото", e_too_large: "Файл слишком большой", e_auth_required: "Войдите в аккаунт", e_server_error: "Ошибка сервера, попробуйте ещё раз",
    e_network: "Нет связи с сервером", e_default: "Что-то пошло не так",
  },
  es: {
    login: "Entrar", signup: "Registrarse", logout: "Salir", openApp: "Abrir la app", tryFree: "Prueba gratis",
    email: "Email", password: "Contraseña", passwordHint: "Mínimo 8 caracteres", createAccount: "Crear cuenta", signIn: "Entrar",
    authTitleIn: "Hola de nuevo", authTitleUp: "Empieza gratis",
    authSubIn: "Entra para continuar", authSubUp: "Sin tarjeta. Tardas 20 segundos.",
    gift: (n) => `🎁 ${n} fotos gratis al registrarte`, giftRef: (n) => `+${n} fotos de regalo del compañero que te invitó`,
    terms: "Al registrarte aceptas las condiciones del servicio.",
    photos: (n) => `${n} ${n === 1 ? "foto" : "fotos"}`, credits: (n) => `${n} ${n === 1 ? "crédito" : "créditos"}`,
    balance: "Saldo", topUp: "Recargar",
    pricingTitle: "Packs de fotos", pricingSub: "Paga solo por las fotos que procesas. Sin suscripción: los créditos no caducan.",
    pack_start: "Inicio", pack_pro: "Profesional", pack_agency: "Agencia", popular: "Más popular",
    perPhoto: (p) => `${p} por foto`, buy: "Comprar", freeName: "Gratis", freeCredits: (n) => `${n} fotos`, freeCta: "Empezar",
    f_all: "Todas las herramientas", f_hd: "Hasta 4K y escalado", f_noexp: "Los créditos no caducan", f_invoice: "Factura para tu contabilidad", f_priority: "Para todo el equipo",
    f_nocard: "Sin tarjeta", f_try: "Pruébalo con tus inmuebles",
    costNote: "1 foto = 1 crédito · 4K = 2 créditos · escalado gratis",
    payOff: "El pago estará disponible pronto. Escríbenos para recargar tu saldo.",
    paid: "Pago completado — créditos añadidos 🎉", canceled: "Pago cancelado",
    e_bad_email: "Revisa el email", e_short_password: "La contraseña debe tener al menos 8 caracteres", e_too_many: "Demasiados intentos, prueba más tarde",
    e_email_taken: "Este email ya está registrado — entra", e_bad_login: "Email o contraseña incorrectos", e_blocked: "Cuenta bloqueada",
    e_no_credits: "No tienes créditos suficientes — recarga tu saldo", e_not_configured: "Servicio no disponible temporalmente", e_payments_off: "Pago no disponible temporalmente",
    e_bad_image: "No se pudo leer la foto", e_too_large: "Archivo demasiado grande", e_auth_required: "Inicia sesión", e_server_error: "Error del servidor, inténtalo de nuevo",
    e_network: "Sin conexión con el servidor", e_default: "Algo ha fallado",
  },
  en: {
    login: "Log in", signup: "Sign up", logout: "Log out", openApp: "Open app", tryFree: "Try it free",
    email: "Email", password: "Password", passwordHint: "At least 8 characters", createAccount: "Create account", signIn: "Log in",
    authTitleIn: "Welcome back", authTitleUp: "Start for free",
    authSubIn: "Log in to continue", authSubUp: "No card needed. Takes 20 seconds.",
    gift: (n) => `🎁 ${n} free photos when you sign up`, giftRef: (n) => `+${n} bonus photos from the colleague who invited you`,
    terms: "By signing up you agree to the terms of service.",
    photos: (n) => `${n} ${n === 1 ? "photo" : "photos"}`, credits: (n) => `${n} ${n === 1 ? "credit" : "credits"}`,
    balance: "Balance", topUp: "Top up",
    pricingTitle: "Photo packs", pricingSub: "Pay only for the photos you process. No subscription — credits never expire.",
    pack_start: "Starter", pack_pro: "Pro", pack_agency: "Agency", popular: "Most popular",
    perPhoto: (p) => `${p} per photo`, buy: "Buy", freeName: "Free", freeCredits: (n) => `${n} photos`, freeCta: "Get started",
    f_all: "All tools included", f_hd: "Up to 4K + upscaling", f_noexp: "Credits never expire", f_invoice: "Invoice for your accounting", f_priority: "For your whole team",
    f_nocard: "No card required", f_try: "Try it on your own listings",
    costNote: "1 photo = 1 credit · 4K = 2 credits · upscaling free",
    payOff: "Payments are coming soon. Contact us to top up your balance.",
    paid: "Payment received — credits added 🎉", canceled: "Payment canceled",
    e_bad_email: "Check your email", e_short_password: "Password must be at least 8 characters", e_too_many: "Too many attempts, try again later",
    e_email_taken: "This email is already registered — log in", e_bad_login: "Wrong email or password", e_blocked: "Account blocked",
    e_no_credits: "Not enough credits — please top up", e_not_configured: "Service temporarily unavailable", e_payments_off: "Payments temporarily unavailable",
    e_bad_image: "Couldn't read the photo", e_too_large: "File too large", e_auth_required: "Please log in", e_server_error: "Server error, please try again",
    e_network: "Can't reach the server", e_default: "Something went wrong",
  },
};
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
const LANGS = ["ru", "es", "en"];
let lang = store.get("lang") || (navigator.language || "en").slice(0, 2);
if (!LANGS.includes(lang)) lang = "en";
const PAGE_I18N = { ru: {}, es: {}, en: {} }; // страницы добавляют свои строки
function t(k, ...a) {
  const v = PAGE_I18N[lang][k] ?? I18N[lang][k] ?? PAGE_I18N.en[k] ?? I18N.en[k] ?? k;
  return typeof v === "function" ? v(...a) : v;
}
const errText = (code) => t("e_" + code) !== "e_" + code ? t("e_" + code) : t("e_default");

const langListeners = [];
function onLang(fn) { langListeners.push(fn); }
function applyLang() {
  document.documentElement.lang = lang;
  $$("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  $$("[data-i18n-html]").forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  $$("[data-i18n-ph]").forEach((el) => (el.placeholder = t(el.dataset.i18nPh)));
  $$(".langs button").forEach((b) => b.classList.toggle("on", b.dataset.lang === lang));
  langListeners.forEach((fn) => fn());
}
function setLang(l) {
  lang = l;
  store.set("lang", l);
  applyLang();
  if (window.ME) api("/api/me/lang", { lang: l }).catch(() => {});
}
function langSwitcherHTML() {
  return `<div class="langs">${LANGS.map((l) => `<button data-lang="${l}">${l.toUpperCase()}</button>`).join("")}</div>`;
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".langs button");
  if (b) setLang(b.dataset.lang);
});

// ---------------- API ----------------
async function api(path, body, method) {
  let r;
  try {
    r = await fetch(path, {
      method: method || (body !== undefined ? "POST" : "GET"),
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    const e = new Error("network"); e.code = "network"; throw e;
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error(data.error || "default");
    e.code = data.error || "default";
    e.status = r.status;
    throw e;
  }
  return data;
}

let CONFIG = null;
async function loadConfig() {
  if (!CONFIG) CONFIG = await api("/api/config").catch(() => ({ packs: [], currency: "eur", freeCredits: 5, refWelcome: 0 }));
  return CONFIG;
}
const money = (cents, cur) =>
  new Intl.NumberFormat(lang === "en" ? "en-IE" : lang === "es" ? "es-ES" : "ru-RU", {
    style: "currency", currency: (cur || CONFIG?.currency || "eur").toUpperCase(),
    minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2,
  }).format(cents / 100);

// Реферальный код из ссылки (?ref=abc) — запоминаем до регистрации
(() => {
  const ref = new URLSearchParams(location.search).get("ref");
  if (ref) store.set("ref", ref);
})();

// ---------------- Toast ----------------
let toastT;
function toast(msg, ms = 2800) {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.className = "toast"; document.body.appendChild(el); }
  el.textContent = msg; el.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), ms);
}

// ---------------- Окно входа / регистрации ----------------
function ensureAuthDialog() {
  if ($("#authDlg")) return;
  const el = document.createElement("div");
  el.className = "dlg-bg"; el.id = "authDlg";
  el.innerHTML = `
    <form class="dlg" id="authForm" novalidate>
      <button type="button" class="x" id="authX" aria-label="close">×</button>
      <div class="tabs2"><button type="button" data-mode="up"></button><button type="button" data-mode="in"></button></div>
      <h3 id="authTitle"></h3>
      <p class="sub" id="authSub"></p>
      <div class="gift" id="authGift"></div>
      <label class="f" for="authEmail" data-i18n="email"></label>
      <input type="email" id="authEmail" autocomplete="email" required />
      <label class="f" for="authPass" data-i18n="password"></label>
      <input type="password" id="authPass" minlength="8" required />
      <div class="fine" id="authPassHint" style="text-align:left;margin-top:6px"></div>
      <div class="form-err" id="authErr"></div>
      <button class="btn full lg" id="authGo" style="margin-top:8px"></button>
      <div class="fine" id="authTerms"></div>
    </form>`;
  document.body.appendChild(el);
  el.querySelectorAll(".tabs2 button").forEach((b) => (b.onclick = () => renderAuth(b.dataset.mode)));
  $("#authX").onclick = () => { if (!authState.locked) el.classList.remove("show"); };
  el.addEventListener("click", (e) => { if (e.target === el && !authState.locked) el.classList.remove("show"); });
  $("#authForm").onsubmit = submitAuth;
  onLang(() => renderAuth(authState.mode));
}
const authState = { mode: "up", locked: false, onDone: null };
function renderAuth(mode) {
  authState.mode = mode;
  const up = mode === "up";
  $$("#authDlg .tabs2 button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === mode);
    b.textContent = b.dataset.mode === "up" ? t("signup") : t("login");
  });
  $("#authTitle").textContent = up ? t("authTitleUp") : t("authTitleIn");
  $("#authSub").textContent = up ? t("authSubUp") : t("authSubIn");
  const free = CONFIG?.freeCredits || 0;
  const refBonus = store.get("ref") && CONFIG?.refWelcome ? CONFIG.refWelcome : 0;
  $("#authGift").hidden = !up || !free;
  $("#authGift").innerHTML = escapeHtml(t("gift", free + refBonus)) + (refBonus ? `<div style="font-weight:500;font-size:12px;margin-top:2px">${escapeHtml(t("giftRef", refBonus))}</div>` : "");
  $("#authPass").autocomplete = up ? "new-password" : "current-password";
  $("#authPassHint").textContent = up ? t("passwordHint") : "";
  $("#authGo").textContent = up ? t("createAccount") : t("signIn");
  $("#authTerms").textContent = up ? t("terms") : "";
  $("#authErr").textContent = "";
  $$("#authDlg [data-i18n]").forEach((n) => (n.textContent = t(n.dataset.i18n)));
}
async function submitAuth(e) {
  e.preventDefault();
  const btn = $("#authGo");
  btn.disabled = true; $("#authErr").textContent = "";
  try {
    const body = { email: $("#authEmail").value, password: $("#authPass").value, lang, ref: store.get("ref") || undefined };
    const r = await api(authState.mode === "up" ? "/api/auth/register" : "/api/auth/login", body);
    window.ME = r.user;
    if (r.user.lang && r.user.lang !== lang && authState.mode === "in") setLang(r.user.lang);
    $("#authDlg").classList.remove("show");
    authState.onDone ? authState.onDone(r.user) : (location.href = "/app");
  } catch (err) {
    $("#authErr").textContent = errText(err.code);
    if (err.code === "email_taken") renderAuth("in"), ($("#authErr").textContent = errText(err.code));
  } finally {
    btn.disabled = false;
  }
}
async function openAuth(mode = "up", { locked = false, onDone = null } = {}) {
  await loadConfig();
  ensureAuthDialog();
  authState.locked = locked; authState.onDone = onDone;
  $("#authX").hidden = locked;
  renderAuth(mode);
  $("#authDlg").classList.add("show");
  setTimeout(() => $("#authEmail").focus(), 50);
}

// ---------------- Тарифы ----------------
function packsHTML({ withFree = false, buyLabel } = {}) {
  const c = CONFIG || { packs: [] };
  const free = withFree && c.freeCredits
    ? `<div class="pack free"><div class="name">${t("freeName")}</div><div class="credits">${t("freeCredits", c.freeCredits)}</div>
        <div class="price">${money(0)}</div><div class="per">${t("f_nocard")}</div>
        <ul><li>${t("f_all")}</li><li>${t("f_try")}</li></ul>
        <button class="btn ghost full" data-pack="free">${t("freeCta")}</button></div>` : "";
  return `<div class="packs">${free}${c.packs.map((p) => `
    <div class="pack ${p.popular ? "popular" : ""}">
      ${p.popular ? `<span class="badge">${t("popular")}</span>` : ""}
      <div class="name">${escapeHtml(t("pack_" + p.id) !== "pack_" + p.id ? t("pack_" + p.id) : p.name || p.id)}</div>
      <div class="credits">${t("photos", p.credits)}</div>
      <div class="price">${money(p.price)}</div>
      <div class="per">${t("perPhoto", money(Math.round(p.price / p.credits)))}</div>
      <ul><li>${t("f_all")}</li><li>${t("f_hd")}</li><li>${t("f_noexp")}</li><li>${t("f_invoice")}</li>${p.credits >= 150 ? `<li>${t("f_priority")}</li>` : ""}</ul>
      <button class="btn ${p.popular ? "" : "ghost"} full" data-pack="${escapeHtml(p.id)}">${buyLabel || t("buy")}</button>
    </div>`).join("")}</div>`;
}

async function buyPack(packId) {
  if (!window.ME) return openAuth("up", { onDone: () => buyPack(packId) });
  if (!CONFIG.payments) return toast(t("payOff") + (CONFIG.supportEmail ? " " + CONFIG.supportEmail : ""), 6000);
  try {
    const r = await api("/api/checkout", { pack: packId });
    location.href = r.url;
  } catch (e) {
    toast(errText(e.code));
  }
}

function ensurePricingDialog() {
  if ($("#priceDlg")) return;
  const el = document.createElement("div");
  el.className = "dlg-bg"; el.id = "priceDlg";
  el.innerHTML = `<div class="dlg wide"><button class="x" aria-label="close">×</button>
    <h3 id="priceTitle"></h3><p class="sub" id="priceSub"></p><div id="priceBody"></div>
    <p class="fine" id="priceNote"></p></div>`;
  document.body.appendChild(el);
  el.querySelector(".x").onclick = () => el.classList.remove("show");
  el.addEventListener("click", (e) => {
    if (e.target === el) el.classList.remove("show");
    const b = e.target.closest("[data-pack]");
    if (b) buyPack(b.dataset.pack);
  });
  const render = () => {
    $("#priceTitle").textContent = t("pricingTitle");
    $("#priceSub").textContent = t("pricingSub");
    $("#priceBody").innerHTML = packsHTML();
    $("#priceNote").textContent = t("costNote");
  };
  onLang(render);
  el._render = render;
}
async function openPricing() {
  await loadConfig();
  ensurePricingDialog();
  $("#priceDlg")._render();
  $("#priceDlg").classList.add("show");
}

const BRAND_SVG = `<svg viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="8" fill="#1f5d4c"/><path d="M7 16.5 16 9l9 7.5V24a1 1 0 0 1-1 1h-5v-5h-6v5H8a1 1 0 0 1-1-1v-7.5Z" fill="#fff"/><circle cx="23.5" cy="8.5" r="2.5" fill="#f2c14e"/></svg>`;
