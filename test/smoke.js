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
// --- мок Stripe (мини-API: аккаунт, вебхуки, сессии, возвраты) ---
let lastCheckout = "";
const mock = { webhooks: [], sessions: {}, refunds: [] };
const stripeMock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const form = new URLSearchParams(body);
    const json = (o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
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
      for (const [k, v] of form) { const m = /^metadata\[(\w+)\]$/.exec(k); if (m) metadata[m[1]] = v; }
      mock.sessions[id] = { id, payment_status: "unpaid", status: "open", amount_total: Number(form.get("line_items[0][price_data][unit_amount]")),
        currency: "eur", client_reference_id: form.get("client_reference_id"), metadata, payment_intent: "pi_" + id };
      return json({ id, url: "https://checkout.stripe.com/c/pay/" + id });
    }
    let m;
    if (req.method === "GET" && (m = /^\/v1\/checkout\/sessions\/(\w+)$/.exec(u.pathname))) {
      const s = mock.sessions[m[1]];
      if (!s) return json({ error: { message: "No such session" } }, 404);
      return json({ ...s, payment_intent: { id: s.payment_intent, latest_charge: { receipt_url: "https://pay.stripe.com/receipts/" + s.id } },
        invoice: { hosted_invoice_url: "https://invoice.stripe.com/i/" + s.id, invoice_pdf: "https://invoice.stripe.com/i/" + s.id + "/pdf" } });
    }
    if (req.method === "POST" && u.pathname === "/v1/refunds") {
      mock.refunds.push({ payment_intent: form.get("payment_intent"), amount: Number(form.get("amount")) });
      return json({ id: "re_" + mock.refunds.length, status: "succeeded" });
    }
    json({ error: { message: "unknown " + req.method + " " + u.pathname } }, 404);
  });
});
const totalRefunded = (pi) => mock.refunds.filter((r) => r.payment_intent === pi).reduce((a, r) => a + r.amount, 0);

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
      ADMIN_EMAILS: "boss@test.com", FREE_CREDITS: "5", REF_BONUS: "10", REF_WELCOME: "3",
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
    assert.equal(r.status, 402); assert.equal(r.data.error, "no_credits");
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

    // оплата B
    r = await B("POST", "/api/checkout", { pack: "pro" });
    assert.equal(r.data.error, "consent_required");
    r = await B("POST", "/api/checkout", { pack: "pro", consent: true });
    assert.equal(r.status, 200);
    assert.ok(lastCheckout.includes("metadata[terms_version]"));
    assert.ok(lastCheckout.includes("custom_text[submit][message]")); assert.ok(r.data.url.startsWith("https://checkout.stripe.com"));
    assert.ok(lastCheckout.includes("line_items[0][price_data][unit_amount]=2900"));
    assert.ok(lastCheckout.includes("success_url=https://shop.example/app?paid=1&session_id={CHECKOUT_SESSION_ID}"));
    assert.ok(lastCheckout.includes("allow_promotion_codes=true"));
    const sid = r.data.url.split("/").pop();
    const me = (await B("GET", "/api/me")).data.user;
    // пока не оплачено — ничего не начисляется
    r = await B("GET", `/api/checkout/confirm?session_id=${sid}`);
    assert.equal(r.data.paid, false); assert.equal(r.data.credits, me.credits);
    // чужую сессию подтвердить нельзя
    r = await A("GET", `/api/checkout/confirm?session_id=${sid}`);
    assert.equal(r.status, 403);
    // клиент оплатил и вернулся со Stripe — кредиты сразу
    Object.assign(mock.sessions[sid], { payment_status: "paid", status: "complete" });
    r = await B("GET", `/api/checkout/confirm?session_id=${sid}`);
    assert.equal(r.data.paid, true); assert.equal(r.data.credits, me.credits + 60);
    // вебхук приходит позже — двойного начисления нет
    const event = JSON.stringify({ type: "checkout.session.completed", data: { object: mock.sessions[sid] } });
    let w = await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: event, headers: { "stripe-signature": "t=1,v1=bad" } });
    assert.equal(w.status, 400);
    for (let i = 0; i < 2; i++) {
      w = await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: event, headers: { "stripe-signature": sign(event) } });
      assert.equal(w.status, 200);
    }
    r = await B("GET", "/api/me");
    assert.equal(r.data.user.credits, me.credits + 60);
    r = await A("GET", "/api/me");
    assert.equal(r.data.user.credits, 10); // бонус пригласившему
    assert.equal(r.data.referrals.paid, 1);
    r = await B("GET", "/api/me/payments");
    assert.equal(r.data.payments.length, 1);
    assert.ok(r.data.payments[0].receipt_url.includes("/receipts/")); assert.ok(r.data.payments[0].invoice_pdf.endsWith("/pdf"));
    console.log("✓ Stripe: начисление сразу после оплаты, вебхук без дублей, чек и счёт, бонус пригласившему");

    // админка
    r = await A("GET", "/api/admin/stats");
    assert.equal(r.status, 403);
    const Boss = client("3.3.3.3");
    await Boss("POST", "/api/auth/register", { email: "boss@test.com", password: "password123", acceptTerms: true });
    r = await Boss("GET", "/api/admin/stats");
    assert.equal(r.data.payments.revenue, 2900); // до возвратов
    r = await Boss("GET", "/api/admin/users?q=agent");
    assert.equal(r.data.users.length, 1);
    await Boss("POST", "/api/admin/credits", { userId: r.data.users[0].id, delta: 7 });
    assert.equal((await A("GET", "/api/me")).data.user.credits, 17);
    console.log("✓ админка: статистика, поиск, начисление");

    // статус Stripe и возвраты
    r = await Boss("GET", "/api/admin/stripe");
    assert.equal(r.data.mode, "test"); assert.equal(r.data.webhook.source, "auto"); assert.ok(r.data.ok);
    r = await Boss("GET", "/api/admin/payments");
    const pay = r.data.payments[0];
    const before = (await B("GET", "/api/me")).data.user.credits;
    r = await Boss("POST", "/api/admin/refund", { paymentId: pay.id, credits: 20 });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.amount, 967); assert.equal(r.data.creditsRemoved, 20);
    assert.equal((await B("GET", "/api/me")).data.user.credits, before - 20);
    // Stripe присылает charge.refunded по этому же возврату — повторно не списываем
    const pi = pay.payment_intent;
    let ev = JSON.stringify({ type: "charge.refunded", data: { object: { payment_intent: pi, amount_refunded: totalRefunded(pi) } } });
    await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: ev, headers: { "stripe-signature": sign(ev) } });
    assert.equal((await B("GET", "/api/me")).data.user.credits, before - 20);
    // полный возврат сделан прямо в Stripe Dashboard — списываем оставшиеся 40
    ev = JSON.stringify({ type: "charge.refunded", data: { object: { payment_intent: pi, amount_refunded: 2900 } } });
    await fetch(`http://127.0.0.1:${PORT}/api/stripe/webhook`, { method: "POST", body: ev, headers: { "stripe-signature": sign(ev) } });
    assert.equal((await B("GET", "/api/me")).data.user.credits, before - 60);
    r = await Boss("POST", "/api/admin/refund", { paymentId: pay.id, credits: 1 });
    assert.equal(r.data.error, "bad_input"); // больше нечего возвращать
    r = await Boss("GET", "/api/admin/stats");
    assert.equal(r.data.payments.revenue, 0); assert.equal(r.data.payments.refunded, 2900);
    console.log("✓ возвраты: из админки (9,67 € за 20 кр.) и из Stripe Dashboard, без двойного списания");

    // покупки в iOS-приложении (StoreKit 2)
    r = await B("GET", "/api/me");
    const token = r.data.user.appAccountToken;
    assert.match(token, /^[0-9a-f-]{36}$/);
    assert.equal((await B("GET", "/api/me")).data.user.appAccountToken, token); // стабильный
    r = await B("GET", "/api/iap/products");
    assert.equal(r.data.products.find((x) => x.packId === "start").productId, "com.realtyphotoai.app.pack.start");
    const tx = { transactionId: "2000000111", bundleId: "com.realtyphotoai.app", productId: "com.realtyphotoai.app.pack.start",
      type: "Consumable", quantity: 1, appAccountToken: token, price: 13990, currency: "EUR", environment: "Sandbox" };
    const bal0 = (await B("GET", "/api/me")).data.user.credits;
    r = await B("POST", "/api/iap/apple", { signedTransaction: appleJWS(tx) });
    assert.equal(r.status, 200, JSON.stringify(r.data)); assert.equal(r.data.credited, true); assert.equal(r.data.credits, bal0 + 20);
    r = await B("POST", "/api/iap/apple", { signedTransaction: appleJWS(tx) });
    assert.equal(r.data.credited, false); assert.equal(r.data.credits, bal0 + 20); // повтор — без двойного начисления
    r = await A("POST", "/api/iap/apple", { signedTransaction: appleJWS({ ...tx, transactionId: "2000000112" }) });
    assert.equal(r.data.error, "wrong_account"); // чужой токен
    r = await B("POST", "/api/iap/apple", { signedTransaction: appleJWS({ ...tx, transactionId: "2000000113" }, { tamper: true }) });
    assert.equal(r.data.error, "bad_signature");
    r = await B("POST", "/api/iap/apple", { signedTransaction: appleJWS({ ...tx, transactionId: "2000000114", bundleId: "com.evil.app" }) });
    assert.equal(r.data.error, "wrong_bundle");
    r = await B("POST", "/api/iap/apple", { signedTransaction: appleJWS({ ...tx, transactionId: "2000000115", productId: "x.y" }) });
    assert.equal(r.data.error, "unknown_product");
    // подделка с чужим корнем — отклоняется
    const fakeX5c = [...CHAIN.x5c]; fakeX5c[2] = fakeX5c[1];
    const fh = b64u(JSON.stringify({ alg: "ES256", x5c: fakeX5c })), fp = b64u(JSON.stringify({ ...tx, transactionId: "2000000116" }));
    r = await B("POST", "/api/iap/apple", { signedTransaction: `${fh}.${fp}.${b64u(crypto.sign("sha256", Buffer.from(fh + "." + fp), { key: CHAIN.leafKey, dsaEncoding: "ieee-p1363" }))}` });
    assert.equal(r.data.error, "untrusted_root");
    // админка видит покупку Apple, возврат через Stripe недоступен
    r = await Boss("GET", "/api/admin/payments");
    const ap = r.data.payments.find((x) => x.provider === "apple");
    assert.equal(ap.amount_cents, 1399); assert.equal(ap.environment, "Sandbox");
    r = await Boss("POST", "/api/admin/refund", { paymentId: ap.id, credits: 5 });
    assert.equal(r.data.error, "apple_refunds_via_apple");
    // Apple присылает REFUND — кредиты списываются
    const note = appleJWS({ notificationType: "REFUND", data: { bundleId: "com.realtyphotoai.app", signedTransactionInfo: appleJWS(tx) } });
    let nr = await fetch(`http://127.0.0.1:${PORT}/api/iap/notifications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedPayload: note }) });
    assert.equal(nr.status, 200);
    assert.equal((await B("GET", "/api/me")).data.user.credits, bal0);
    nr = await fetch(`http://127.0.0.1:${PORT}/api/iap/notifications`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedPayload: note }) });
    assert.equal((await B("GET", "/api/me")).data.user.credits, bal0); // повтор — без двойного списания
    console.log("✓ App Store: проверка подписи Apple, привязка к аккаунту, без дублей, возврат по уведомлению Apple");

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
