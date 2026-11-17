// Сквозной тест: моки fal.ai и Stripe + настоящий Postgres.
// Запуск: DATABASE_URL=postgres://... npm test
const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");
const assert = require("assert");

const DB = process.env.DATABASE_URL;
if (!DB) { console.error("Нужен DATABASE_URL тестовой базы"); process.exit(1); }

const PORT = 3999, FAL_PORT = 4001, STRIPE_PORT = 4002;
const WHSEC = "whsec_test123";

// --- мок fal.ai ---
const fal = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const base = `http://127.0.0.1:${FAL_PORT}`;
    if (req.method === "POST") {
      const input = JSON.parse(body);
      const id = crypto.randomUUID();
      const fail = String(input.prompt || "").includes("FAIL");
      const kind = req.url.includes("seedvr") ? "up" : "edit";
      res.end(JSON.stringify({ status_url: `${base}/s/${id}`, response_url: `${base}/r/${kind}/${fail ? "fail" : "ok"}` }));
    } else if (req.url.startsWith("/s/")) {
      res.end(JSON.stringify({ status: "COMPLETED" }));
    } else if (req.url === "/r/edit/ok") {
      res.end(JSON.stringify({ images: [{ url: `${base}/img.jpg` }] }));
    } else if (req.url === "/img.jpg") {
      res.writeHead(200, { "Content-Type": "image/jpeg" }); res.end(Buffer.from("AFTERJPEG"));
    } else if (req.url === "/r/up/ok") {
      res.end(JSON.stringify({ image: { url: "https://v3.fal.media/files/test/upscaled.jpg" } }));
    } else {
      res.writeHead(500); res.end(JSON.stringify({ detail: "model error" }));
    }
  });
});
// --- мок Stripe (мини-API: аккаунт, вебхуки, сессии подписки, подписки, возвраты) ---
let lastCheckout = "";
const mock = { webhooks: [], sessions: {}, subs: {}, refunds: [] };
const DAY = 86400;
function newSub(id, userId, startSec) {
  return { id, object: "subscription", customer: "cus_" + userId, status: "active", cancel_at_period_end: false,
    metadata: { user_id: String(userId) }, items: { data: [{ current_period_start: startSec, current_period_end: startSec + 7 * DAY }] } };
}
const stripeMock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const form = new URLSearchParams(body);
    const json = (o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    let m;
    if (req.method === "GET" && u.pathname === "/v1/account")
      return json({ id: "acct_1", charges_enabled: true, details_submitted: true, country: "ES", settings: { dashboard: { display_name: "Test Shop" } } });
    if (u.pathname === "/v1/webhook_endpoints" && req.method === "GET") return json({ data: mock.webhooks });
    if (u.pathname === "/v1/webhook_endpoints" && req.method === "POST") {
      const ep = { id: "we_" + mock.webhooks.length, url: form.get("url"), status: "enabled", secret: WHSEC,
        enabled_events: [...form.keys()].filter((k) => k.startsWith("enabled_events")).map((k) => form.get(k)) };
      mock.webhooks.push(ep);
      return json(ep);
    }
    if (req.method === "POST" && u.pathname === "/v1/checkout/sessions") {
      lastCheckout = decodeURIComponent(body);
      const id = "cs_test_" + Object.keys(mock.sessions).length;
      const metadata = {};
      for (const [k, v] of form) { const mm = /^metadata\[(\w+)\]$/.exec(k); if (mm) metadata[mm[1]] = v; }
      mock.sessions[id] = { id, mode: form.get("mode"), status: "open", payment_status: "unpaid", client_reference_id: form.get("client_reference_id"), metadata, subscription: null, invoice: null };
      return json({ id, url: "https://checkout.stripe.com/c/pay/" + id });
    }
    if (req.method === "GET" && (m = /^\/v1\/checkout\/sessions\/(\w+)$/.exec(u.pathname))) {
      const s = mock.sessions[m[1]];
      if (!s) return json({ error: { message: "No such session" } }, 404);
      return json({ ...s, subscription: s.subscription ? mock.subs[s.subscription] : null });
    }
    if ((m = /^\/v1\/subscriptions\/(\w+)$/.exec(u.pathname))) {
      const sub = mock.subs[m[1]];
      if (!sub) return json({ error: { message: "No such subscription" } }, 404);
      if (req.method === "POST" && form.has("cancel_at_period_end")) sub.cancel_at_period_end = form.get("cancel_at_period_end") === "true";
      return json(sub);
    }
    if (req.method === "POST" && u.pathname === "/v1/refunds") {
      mock.refunds.push({ payment_intent: form.get("payment_intent"), amount: Number(form.get("amount")) });
      return json({ id: "re_" + mock.refunds.length, status: "succeeded" });
    }
    json({ error: { message: "unknown " + req.method + " " + u.pathname } }, 404);
  });
});

function sign(payload) {
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", WHSEC).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${sig}`;
}

function client(ip) {
  let cookie = "";
  return async (method, p, body, headers = {}) => {
    const r = await fetch(`http://127.0.0.1:${PORT}${p}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), cookie, "x-forwarded-for": ip, ...headers },
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const data = await r.json().catch(() => ({}));
    return { status: r.status, data };
  };
}

// --- тестовая цепочка сертификатов «как у Apple» (root → intermediate → leaf, EC P-256, с OID Apple) ---
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const CA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "appleca-"));
function makeChain() {
  const sh = (c) => execSync(c, { cwd: CA_DIR, stdio: "pipe" });
  fs.writeFileSync(path.join(CA_DIR, "ext.cnf"), [
    "[ca]", "basicConstraints=critical,CA:true", "keyUsage=critical,keyCertSign,cRLSign",
    "[mid]", "basicConstraints=critical,CA:true", "keyUsage=critical,keyCertSign,cRLSign", "1.2.840.113635.100.6.2.1=ASN1:NULL",
    "[leaf]", "basicConstraints=critical,CA:false", "keyUsage=critical,digitalSignature", "1.2.840.113635.100.6.11.1=ASN1:NULL",
  ].join("\n"));
  for (const n of ["root", "mid", "leaf"]) sh(`openssl ecparam -name prime256v1 -genkey -noout -out ${n}.key`);
  sh(`openssl req -x509 -new -key root.key -subj "/CN=Test Root" -days 30 -out root.pem -extensions ca -config ext.cnf`);
  sh(`openssl req -new -key mid.key -subj "/CN=Test Mid" -out mid.csr`);
  sh(`openssl x509 -req -in mid.csr -CA root.pem -CAkey root.key -CAcreateserial -days 30 -extfile ext.cnf -extensions mid -out mid.pem`);
  sh(`openssl req -new -key leaf.key -subj "/CN=Test Leaf" -out leaf.csr`);
  sh(`openssl x509 -req -in leaf.csr -CA mid.pem -CAkey mid.key -CAcreateserial -days 30 -extfile ext.cnf -extensions leaf -out leaf.pem`);
  const der = (n) => new crypto.X509Certificate(fs.readFileSync(path.join(CA_DIR, n + ".pem"))).raw.toString("base64");
  return { x5c: [der("leaf"), der("mid"), der("root")], leafKey: fs.readFileSync(path.join(CA_DIR, "leaf.key")), rootB64: der("root") };
}
const CHAIN = makeChain();
const b64u = (b) => Buffer.from(b).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
function appleJWS(payload, { tamper = false } = {}) {
  const h = b64u(JSON.stringify({ alg: "ES256", x5c: CHAIN.x5c }));
  const p = b64u(JSON.stringify(payload));
  let sig = crypto.sign("sha256", Buffer.from(`${h}.${p}`), { key: CHAIN.leafKey, dsaEncoding: "ieee-p1363" });
  if (tamper) sig[5] ^= 0xff;
  return `${h}.${p}.${b64u(sig)}`;
}

const IMG = "data:image/jpeg;base64," + Buffer.from("fakejpeg").toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitJob(c, id) {
  for (let i = 0; i < 40; i++) {
    const r = await c("GET", `/api/jobs/${id}`);
    if (["done", "failed"].includes(r.data.job.status)) return r.data;
    await sleep(500);
  }
  throw new Error("job timeout");
}

(async () => {
  await new Promise((r) => fal.listen(FAL_PORT, r));
  await new Promise((r) => stripeMock.listen(STRIPE_PORT, r));
  const srv = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: {
      ...process.env, PORT: String(PORT), FAL_KEY: "test", FAL_QUEUE_BASE: `http://127.0.0.1:${FAL_PORT}`,
      STRIPE_SECRET_KEY: "sk_test_x", STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`, PUBLIC_URL: "https://shop.example",
      STRIPE_WEBHOOK_SECRET: "",
      APPLE_ROOT_CERTS_B64: CHAIN.rootB64, APPLE_BUNDLE_ID: "com.realtyphotoai.app",
      ADMIN_EMAILS: "boss@test.com", FREE_CREDITS: "5", SUB_WEEKLY_LIMIT: "3", SUB_PRICE: "999", SUB_CURRENCY: "usd", REF_BONUS: "10", REF_WELCOME: "3",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/health`); break; } catch { await sleep(200); } }
    for (let i = 0; i < 25 && !mock.webhooks.length; i++) await sleep(200);
    assert.equal(mock.webhooks.length, 1, "вебхук создан автоматически");
    assert.equal(mock.webhooks[0].url, "https://shop.example/api/stripe/webhook");
    assert.ok(mock.webhooks[0].enabled_events.includes("charge.refunded"));
    console.log("✓ Stripe: вебхук создан автоматически по одному ключу");

    const A = client("1.1.1.1");
    let r = await A("POST", "/api/auth/register", { email: "Agent@Test.com", password: "short", lang: "es" });
    assert.equal(r.data.error, "short_password");
    r = await A("POST", "/api/auth/register", { email: "agent@test.com", password: "password123", lang: "es" });
    assert.equal(r.data.error, "terms_required");
    r = await A("POST", "/api/auth/register", { email: "agent@test.com", password: "password123", acceptTerms: true, lang: "es" });
    assert.equal(r.status, 200); assert.equal(r.data.user.credits, 5);
    const refCode = r.data.user.refCode;
    r = await A("POST", "/api/auth/register", { email: "agent@test.com", password: "password123", acceptTerms: true });
    assert.equal(r.data.error, "email_taken");
    console.log("✓ регистрация, 5 бесплатных кредитов");

    // CSRF: не-JSON запросы отклоняются
    r = await A("POST", "/api/jobs", "preset=enhance", { "Content-Type": "text/plain" });
    assert.equal(r.status, 415);

    r = await A("POST", "/api/jobs", { preset: "staging", prompt: "Stage this room nicely please", model: "fal-ai/nano-banana-pro/edit", resolution: "2K", upscale: true, image: IMG, thumb: IMG, name: "salon" });
    assert.equal(r.status, 200); assert.equal(r.data.credits, 4);
    let j = await waitJob(A, r.data.id);
    assert.equal(j.job.status, "done"); assert.equal(j.job.result_url, "https://v3.fal.media/files/test/upscaled.jpg");
    console.log("✓ обработка + апскейл, списан 1 кредит");

    r = await A("POST", "/api/jobs", { preset: "custom", prompt: "please FAIL this one", model: "fal-ai/nano-banana-pro/edit", resolution: "4K", image: IMG });
    assert.equal(r.data.credits, 2); // 4K = 2 кредита
    j = await waitJob(A, r.data.id);
    assert.equal(j.job.status, "failed"); assert.equal(j.credits, 4);
    console.log("✓ 4K = 2 кредита, при ошибке кредиты возвращаются");

    for (let i = 0; i < 4; i++) await A("POST", "/api/jobs", { preset: "upscale", image: IMG });
    r = await A("POST", "/api/jobs", { preset: "upscale", image: IMG });
    assert.equal(r.status, 402); assert.equal(r.data.error, "subscription_required");
    console.log("✓ без кредитов — 402");

    r = await A("GET", "/api/jobs");
    assert.ok(r.data.jobs.length >= 6);
    console.log("✓ история:", r.data.jobs.length, "записей");

    // реферал: B приходит по ссылке A с другого IP
    const B = client("2.2.2.2");
    r = await B("POST", "/api/auth/register", { email: "friend@test.com", password: "password123", acceptTerms: true, ref: refCode });
    assert.equal(r.data.user.credits, 8); // 5 + 3
    // самореферал с того же IP не даёт бонус
    const A2 = client("1.1.1.1");
    r = await A2("POST", "/api/auth/register", { email: "fake@test.com", password: "password123", acceptTerms: true, ref: refCode });
    assert.equal(r.data.user.credits, 5);
    console.log("✓ рефералка: +3 приглашённому, защита от самоприглашения");

    // подписка B через Stripe
    r = await B("POST", "/api/checkout", {});
    assert.equal(r.data.error, "consent_required");
    r = await B("POST", "/api/checkout", { consent: true });
    assert.equal(r.status, 200);
    assert.ok(lastCheckout.includes("mode=subscription"));
    assert.ok(lastCheckout.includes("line_items[0][price_data][recurring][interval]=week"));
    assert.ok(lastCheckout.includes("line_items[0][price_data][unit_amount]=999"));
    assert.ok(lastCheckout.includes("line_items[0][price_data][currency]=usd"));
    assert.ok(lastCheckout.includes("success_url=https://shop.example/app?paid=1&session_id={CHECKOUT_SESSION_ID}"));
    const sid = r.data.url.split("/").pop();
    const bId = await getId("friend@test.com");
    r = await B("GET", `/api/checkout/confirm?session_id=${sid}`);
    assert.equal(r.data.subscription.active, false);
    r = await A("GET", `/api/checkout/confirm?session_id=${sid}`);
    assert.equal(r.status, 403); // чужая сессия
    // клиент оплатил
    const now = Math.floor(Date.now() / 1000);
    mock.subs.sub_b = newSub("sub_b", bId, now - 60);
    Object.assign(mock.sessions[sid], { status: "complete", payment_status: "paid", subscription: "sub_b", customer: "cus_" + bId,
      invoice: { id: "in_1", amount_paid: 999, currency: "usd", payment_intent: "pi_in_1", hosted_invoice_url: "https://invoice.stripe.com/i/in_1", invoice_pdf: "https://invoice.stripe.com/i/in_1/pdf" } });
    r = await B("GET", `/api/checkout/confirm?session_id=${sid}`);
    assert.equal(r.data.subscription.active, true); assert.equal(r.data.subscription.provider, "stripe");
    assert.deepEqual(r.data.usage, { used: 0, limit: 3, remaining: 3 });
    r = await B("POST", "/api/checkout", { consent: true });
    assert.equal(r.data.error, "already_subscribed");
    // вебхук приходит позже — без дублей
    const ev1 = JSON.stringify({ type: "checkout.session.completed", data: { object: { ...mock.sessions[sid] } } });
    let w = await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: ev1, headers: { "stripe-signature": "t=1,v1=bad" } });
    assert.equal(w.status, 400);
    for (let i = 0; i < 2; i++) {
      w = await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: ev1, headers: { "stripe-signature": sign(ev1) } });
      assert.equal(w.status, 200);
    }
    r = await B("GET", "/api/me/payments");
    assert.equal(r.data.payments.length, 1); assert.ok(r.data.payments[0].invoice_pdf.endsWith("/pdf"));
    r = await A("GET", "/api/me");
    assert.equal(r.data.user.credits, 10); // бонус пригласившему за первую оплату друга
    assert.equal(r.data.referrals.paid, 1);
    console.log("✓ Stripe: недельная подписка $9.99, включается сразу после оплаты, вебхук без дублей, счёт, бонус пригласившему");

    // лимит недели: 3 по подписке (в тесте), дальше — бесплатные кредиты
    const credB = (await B("GET", "/api/me")).data.credits;
    for (let i = 0; i < 3; i++) {
      r = await B("POST", "/api/jobs", { preset: "enhance", prompt: "Enhance this listing photo", image: IMG });
      assert.equal(r.data.billing, "sub", JSON.stringify(r.data));
    }
    assert.equal(r.data.usage.used, 3); assert.equal(r.data.credits, credB);
    r = await B("POST", "/api/jobs", { preset: "enhance", prompt: "Enhance this listing photo", image: IMG });
    assert.equal(r.data.billing, "credits"); assert.equal(r.data.credits, credB - 1);
    console.log("✓ лимит 3 фото за неделю по подписке, сверх — пробные кредиты");

    // отмена и возобновление
    r = await B("POST", "/api/billing/cancel", {});
    assert.equal(r.data.subscription.cancelAtPeriodEnd, true); assert.equal(r.data.subscription.active, true);
    r = await B("POST", "/api/billing/resume", {});
    assert.equal(r.data.subscription.cancelAtPeriodEnd, false);
    // продление: новый период, счёт записан, лимит обнулился
    mock.subs.sub_b.items.data[0] = { current_period_start: now + 7 * DAY - 10, current_period_end: now + 14 * DAY };
    const evRenew = JSON.stringify({ type: "invoice.paid", data: { object: { id: "in_2", subscription: "sub_b", amount_paid: 999, currency: "usd", payment_intent: "pi_in_2" } } });
    await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: evRenew, headers: { "stripe-signature": sign(evRenew) } });
    assert.equal((await B("GET", "/api/me/payments")).data.payments.length, 2);
    // подписка удалена в Stripe → доступ закрыт
    const evDel = JSON.stringify({ type: "customer.subscription.deleted", data: { object: { ...mock.subs.sub_b, status: "canceled", ended_at: now } } });
    await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: evDel, headers: { "stripe-signature": sign(evDel) } });
    r = await B("GET", "/api/me");
    assert.equal(r.data.subscription.active, false);
    console.log("✓ отмена/возобновление, продление по invoice.paid, завершение по subscription.deleted");

    // админка
    r = await A("GET", "/api/admin/stats");
    assert.equal(r.status, 403);
    const Boss = client("3.3.3.3");
    await Boss("POST", "/api/auth/register", { email: "boss@test.com", password: "password123", acceptTerms: true });
    r = await Boss("GET", "/api/admin/stats");
    assert.equal(r.data.payments.revenue, 1998); // две недели подписки
    assert.equal(r.data.users.subscribers, 0);
    r = await Boss("GET", "/api/admin/users?q=agent");
    assert.equal(r.data.users.length, 1);
    await Boss("POST", "/api/admin/credits", { userId: r.data.users[0].id, delta: 7 });
    assert.equal((await A("GET", "/api/me")).data.user.credits, 17);
    console.log("✓ админка: статистика, поиск, начисление");

    // статус Stripe и возврат по счёту подписки
    r = await Boss("GET", "/api/admin/stripe");
    assert.equal(r.data.mode, "test"); assert.equal(r.data.webhook.source, "auto"); assert.ok(r.data.ok);
    let ev = JSON.stringify({ type: "charge.refunded", data: { object: { payment_intent: "pi_in_2", amount_refunded: 999 } } });
    await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: ev, headers: { "stripe-signature": sign(ev) } });
    r = await Boss("GET", "/api/admin/stats");
    assert.equal(r.data.payments.revenue, 999); assert.equal(r.data.payments.refunded, 999);
    console.log("✓ возврат в Stripe Dashboard учитывается в выручке");

    // подписка в iOS-приложении (StoreKit 2)
    const C = client("5.5.5.5");
    await C("POST", "/api/auth/register", { email: "ios@test.com", password: "password123", acceptTerms: true });
    r = await C("GET", "/api/me");
    const token = r.data.user.appAccountToken;
    assert.match(token, /^[0-9a-f-]{36}$/);
    assert.equal((await C("GET", "/api/me")).data.user.appAccountToken, token);
    r = await C("GET", "/api/iap/products");
    assert.equal(r.data.subscription, "com.realtyphotoai.app.weekly");
    const t0 = Date.now();
    const tx = { transactionId: "3000000001", originalTransactionId: "3000000001", bundleId: "com.realtyphotoai.app",
      productId: "com.realtyphotoai.app.weekly", type: "Auto-Renewable Subscription", appAccountToken: token,
      purchaseDate: t0 - 1000, expiresDate: t0 + 7 * 864e5, price: 9990, currency: "USD", environment: "Sandbox" };
    r = await C("POST", "/api/iap/apple", { signedTransaction: appleJWS(tx) });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.subscription.active, true); assert.equal(r.data.subscription.provider, "apple");
    r = await C("POST", "/api/iap/apple", { signedTransaction: appleJWS(tx) });
    assert.equal(r.status, 200); // повтор безопасен
    r = await C("POST", "/api/jobs", { preset: "enhance", prompt: "Enhance this listing photo", image: IMG });
    assert.equal(r.data.billing, "sub");
    r = await A("POST", "/api/iap/apple", { signedTransaction: appleJWS({ ...tx, transactionId: "3000000009" }) });
    assert.equal(r.data.error, "wrong_account"); // чужой токен
    r = await C("POST", "/api/iap/apple", { signedTransaction: appleJWS({ ...tx, transactionId: "3000000002" }, { tamper: true }) });
    assert.equal(r.data.error, "bad_signature");
    r = await C("POST", "/api/iap/apple", { signedTransaction: appleJWS({ ...tx, bundleId: "com.evil.app" }) });
    assert.equal(r.data.error, "wrong_bundle");
    r = await C("POST", "/api/iap/apple", { signedTransaction: appleJWS({ ...tx, productId: "x.y" }) });
    assert.equal(r.data.error, "unknown_product");
    const fakeX5c = [...CHAIN.x5c]; fakeX5c[2] = fakeX5c[1];
    const fh = b64u(JSON.stringify({ alg: "ES256", x5c: fakeX5c })), fp = b64u(JSON.stringify(tx));
    r = await C("POST", "/api/iap/apple", { signedTransaction: `${fh}.${fp}.${b64u(crypto.sign("sha256", Buffer.from(fh + "." + fp), { key: CHAIN.leafKey, dsaEncoding: "ieee-p1363" }))}` });
    assert.equal(r.data.error, "untrusted_root");
    const notify = (type, t, renewal) => fetch(`http://127.0.0.1:${PORT}/api/iap/notifications`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedPayload: appleJWS({ notificationType: type, data: { bundleId: "com.realtyphotoai.app",
        signedTransactionInfo: appleJWS(t), ...(renewal ? { signedRenewalInfo: appleJWS(renewal) } : {}) } }) }) });
    // автопродление выключено пользователем
    await notify("DID_CHANGE_RENEWAL_STATUS", tx, { autoRenewStatus: 0 });
    assert.equal((await C("GET", "/api/me")).data.subscription.cancelAtPeriodEnd, true);
    // продление
    const tx2 = { ...tx, transactionId: "3000000002", purchaseDate: t0 + 7 * 864e5, expiresDate: t0 + 14 * 864e5 };
    assert.equal((await notify("DID_RENEW", tx2, { autoRenewStatus: 1 })).status, 200);
    r = await C("GET", "/api/me");
    assert.ok(new Date(r.data.subscription.expiresAt).getTime() >= t0 + 14 * 864e5 - 1000);
    assert.equal(r.data.subscription.cancelAtPeriodEnd, false);
    // возврат Apple — доступ закрывается
    await notify("REFUND", { ...tx2, revocationDate: Date.now() });
    assert.equal((await C("GET", "/api/me")).data.subscription.active, false);
    r = await Boss("GET", "/api/admin/payments");
    const ap = r.data.payments.find((x) => x.provider === "apple" && x.payment_intent === "apple:3000000002");
    assert.equal(ap.amount_cents, 999); assert.equal(ap.refunded_cents, 999); assert.equal(ap.environment, "Sandbox");
    console.log("✓ App Store: подписка по подписи Apple, привязка к аккаунту, автопродление, продление, возврат");

    // демо на главной: генерирует админ, публика видит только опубликованные
    r = await A("POST", "/api/admin/demos", { image: IMG, preset: "staging", prompt: "Stage it" });
    assert.equal(r.status, 403);
    r = await Boss("POST", "/api/admin/demos", { image: IMG, preset: "staging", prompt: "Stage the living room" });
    assert.equal(r.status, 200);
    const demoId = r.data.id;
    for (let i = 0; i < 20; i++) {
      const l = await Boss("GET", "/api/admin/demos");
      if (l.data.demos[0].status !== "running") break;
      await sleep(300);
    }
    r = await Boss("GET", "/api/admin/demos");
    assert.equal(r.data.demos[0].status, "done", JSON.stringify(r.data.demos[0]));
    let pub = await fetch(`http://127.0.0.1:${PORT}/demo-img/${demoId}/after`);
    assert.equal(pub.status, 401); // не опубликовано — не видно
    assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/api/demos`)).json()).demos.length, 0);
    await Boss("POST", `/api/admin/demos/${demoId}/update`, { published: true });
    const list = await (await fetch(`http://127.0.0.1:${PORT}/api/demos`)).json();
    assert.equal(list.demos.length, 1);
    pub = await fetch(`http://127.0.0.1:${PORT}/demo-img/${demoId}/after`);
    assert.equal(pub.status, 200); assert.equal(await pub.text(), "AFTERJPEG");
    pub = await fetch(`http://127.0.0.1:${PORT}/demo-img/${demoId}/before`);
    assert.equal(await pub.text(), "fakejpeg");
    await Boss("DELETE", `/api/admin/demos/${demoId}`);
    assert.equal((await (await fetch(`http://127.0.0.1:${PORT}/api/demos`)).json()).demos.length, 0);
    console.log("✓ демо: генерация из админки, публикация, удаление");

    r = await A("POST", "/api/auth/logout", {});
    r = await A("GET", "/api/me");
    assert.equal(r.status, 401);
    r = await A("POST", "/api/auth/login", { email: "agent@test.com", password: "wrong-pass" });
    assert.equal(r.data.error, "bad_login");
    r = await A("POST", "/api/auth/login", { email: "AGENT@test.com", password: "password123", acceptTerms: true });
    assert.equal(r.status, 200);
    console.log("✓ выход и вход");

    // удаление аккаунта (RGPD ст. 17)
    const D = client("4.4.4.4");
    await D("POST", "/api/auth/register", { email: "bye@test.com", password: "password123", acceptTerms: true });
    r = await D("POST", "/api/me/delete", { password: "wrong-pass" });
    assert.equal(r.data.error, "bad_login");
    r = await D("POST", "/api/me/delete", { password: "password123" });
    assert.equal(r.status, 200);
    assert.equal((await D("GET", "/api/me")).status, 401);
    r = await D("POST", "/api/auth/login", { email: "bye@test.com", password: "password123" });
    assert.equal(r.status, 401);
    r = await D("POST", "/api/auth/register", { email: "bye@test.com", password: "password123", acceptTerms: true });
    assert.equal(r.status, 200); // email освобождён
    console.log("✓ согласия при регистрации и оплате, удаление аккаунта");

    for (const p of ["/", "/app", "/admin", "/common.js", "/aviso-legal", "/privacidad", "/condiciones", "/cookies", "/fonts/manrope-latin-wght-normal.woff2"]) {
      const s = await fetch(`http://127.0.0.1:${PORT}${p}`);
      assert.equal(s.status, 200, p);
    }
    console.log("\nВСЕ ТЕСТЫ ПРОШЛИ ✅");
  } finally {
    srv.kill(); fal.close(); stripeMock.close();
  }

  async function getId(email) {
    const { Client } = require("pg");
    const c = new Client({ connectionString: DB });
    await c.connect();
    const { rows } = await c.query("SELECT id FROM users WHERE email=$1", [email]);
    await c.end();
    return rows[0].id;
  }
})().catch((e) => { console.error("✗ ТЕСТ УПАЛ:", e); process.exit(1); });
