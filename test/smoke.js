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
      res.end(JSON.stringify({ images: [{ url: "https://v3.fal.media/files/test/edited.jpg" }] }));
    } else if (req.url === "/r/up/ok") {
      res.end(JSON.stringify({ image: { url: "https://v3.fal.media/files/test/upscaled.jpg" } }));
    } else {
      res.writeHead(500); res.end(JSON.stringify({ detail: "model error" }));
    }
  });
});
// --- мок Stripe ---
let lastCheckout = "";
const stripeMock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    lastCheckout = decodeURIComponent(body);
    res.end(JSON.stringify({ id: "cs_test_" + Date.now(), url: "https://checkout.stripe.com/c/pay/test" }));
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
      STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: `http://127.0.0.1:${STRIPE_PORT}`,
      ADMIN_EMAILS: "boss@test.com", FREE_CREDITS: "5", REF_BONUS: "10", REF_WELCOME: "3",
    },
    stdio: ["ignore", "inherit", "inherit"],
  });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/health`); break; } catch { await sleep(200); } }

    const A = client("1.1.1.1");
    let r = await A("POST", "/api/auth/register", { email: "Agent@Test.com", password: "short", lang: "es" });
    assert.equal(r.data.error, "short_password");
    r = await A("POST", "/api/auth/register", { email: "agent@test.com", password: "password123", lang: "es" });
    assert.equal(r.status, 200); assert.equal(r.data.user.credits, 5);
    const refCode = r.data.user.refCode;
    r = await A("POST", "/api/auth/register", { email: "agent@test.com", password: "password123" });
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
    r = await B("POST", "/api/auth/register", { email: "friend@test.com", password: "password123", ref: refCode });
    assert.equal(r.data.user.credits, 8); // 5 + 3
    // самореферал с того же IP не даёт бонус
    const A2 = client("1.1.1.1");
    r = await A2("POST", "/api/auth/register", { email: "fake@test.com", password: "password123", ref: refCode });
    assert.equal(r.data.user.credits, 5);
    console.log("✓ рефералка: +3 приглашённому, защита от самоприглашения");

    // оплата B
    r = await B("POST", "/api/checkout", { pack: "pro" });
    assert.equal(r.status, 200); assert.ok(r.data.url.startsWith("https://checkout.stripe.com"));
    assert.ok(lastCheckout.includes("line_items[0][price_data][unit_amount]=2900"));
    const me = (await B("GET", "/api/me")).data.user;
    const event = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { id: "cs_test_paid_1", payment_status: "paid", amount_total: 2900, currency: "eur", client_reference_id: "x", metadata: { user_id: String((await getId("friend@test.com"))), pack: "pro", credits: "60" } } },
    });
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
    console.log("✓ Stripe: подпись проверяется, кредиты начислены один раз, бонус пригласившему +10");

    // админка
    r = await A("GET", "/api/admin/stats");
    assert.equal(r.status, 403);
    const Boss = client("3.3.3.3");
    await Boss("POST", "/api/auth/register", { email: "boss@test.com", password: "password123" });
    r = await Boss("GET", "/api/admin/stats");
    assert.equal(r.data.payments.revenue, 2900);
    r = await Boss("GET", "/api/admin/users?q=agent");
    assert.equal(r.data.users.length, 1);
    await Boss("POST", "/api/admin/credits", { userId: r.data.users[0].id, delta: 7 });
    assert.equal((await A("GET", "/api/me")).data.user.credits, 17);
    console.log("✓ админка: статистика, поиск, начисление");

    r = await A("POST", "/api/auth/logout", {});
    r = await A("GET", "/api/me");
    assert.equal(r.status, 401);
    r = await A("POST", "/api/auth/login", { email: "agent@test.com", password: "wrong-pass" });
    assert.equal(r.data.error, "bad_login");
    r = await A("POST", "/api/auth/login", { email: "AGENT@test.com", password: "password123" });
    assert.equal(r.status, 200);
    console.log("✓ выход и вход");

    for (const p of ["/", "/app", "/admin", "/common.js"]) {
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
