// Realty Photo AI — сервер: аккаунты, кредиты, обработка фото через fal.ai, оплата Stripe
// Запуск: DATABASE_URL=... FAL_KEY=... node server.js   (Node 18+)

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const config = require("./lib/config");
const db = require("./lib/db");
const auth = require("./lib/auth");
const fal = require("./lib/fal");
const stripe = require("./lib/stripe");

const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY = 25 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = [/\.fal\.media$/, /^fal\.media$/, /^storage\.googleapis\.com$/];
const PRESETS = new Set(["enhance", "staging", "declutter", "empty", "sky", "twilight", "lawn", "refresh", "upscale", "custom"]);

// ---------- helpers ----------
function send(res, code, obj, headers = {}) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        reject(auth.httpErr(413, "too_large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function readJson(req, limit) {
  // JSON-only API: браузер не отправит такой запрос с чужого сайта без CORS-preflight (защита от CSRF)
  if (!(req.headers["content-type"] || "").includes("application/json")) throw auth.httpErr(415, "json_required");
  try {
    return JSON.parse((await readBody(req, limit)) || "{}");
  } catch (e) {
    if (e.status) throw e;
    throw auth.httpErr(400, "bad_json");
  }
}
const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";
const baseUrl = (req) =>
  config.PUBLIC_URL || `${(req.headers["x-forwarded-proto"] || "http").split(",")[0]}://${req.headers.host}`;

async function requireUser(req) {
  const u = await auth.getUser(req);
  if (!u) throw auth.httpErr(401, "auth_required");
  return u;
}
async function requireAdmin(req) {
  const u = await requireUser(req);
  if (!u.isAdmin) throw auth.httpErr(403, "forbidden");
  return u;
}
const publicUser = (u) => ({
  email: u.email,
  credits: u.credits,
  lang: u.lang,
  refCode: u.ref_code,
  isAdmin: !!u.isAdmin,
});

// ---------- очередь обработки (ограничиваем параллельность) ----------
const MAX_RUNNING = Number(process.env.MAX_RUNNING || 8);
let running = 0;
const waiting = [];
function schedule(fn) {
  return new Promise((resolve) => {
    const go = async () => {
      running++;
      try { await fn(); } finally {
        running--;
        resolve();
        const next = waiting.shift();
        if (next) next();
      }
    };
    running < MAX_RUNNING ? go() : waiting.push(go);
  });
}

async function runJob(job, payload) {
  await schedule(async () => {
    await db.q("UPDATE jobs SET status='running' WHERE id=$1", [job.id]);
    try {
      const url = await fal.processPhoto(payload);
      await db.q("UPDATE jobs SET status='done', result_url=$2, finished_at=now() WHERE id=$1", [job.id, url]);
    } catch (e) {
      console.error("job failed", job.id, e.message);
      await db.tx(async (c) => {
        await c.query("UPDATE jobs SET status='failed', error=$2, finished_at=now() WHERE id=$1", [job.id, e.message.slice(0, 400)]);
        await db.addCredits(job.user_id, job.cost, "refund", job.id, c);
      });
    }
  });
}

// ---------- обработчики ----------
const routes = {
  "GET /api/config": async () => ({
    brand: config.BRAND,
    currency: config.CURRENCY,
    packs: config.PACKS,
    freeCredits: config.FREE_CREDITS,
    refBonus: config.REF_BONUS,
    refWelcome: config.REF_WELCOME,
    payments: !!config.STRIPE_SECRET_KEY,
    supportEmail: config.SUPPORT_EMAIL || config.LEGAL.email,
    legal: config.LEGAL,
    termsVersion: config.TERMS_VERSION,
  }),

  "POST /api/auth/register": async (req, res) => {
    const body = await readJson(req, 10000);
    const user = await auth.register(body, clientIp(req));
    await auth.createSession(res, req, user.id);
    const fresh = (await db.q("SELECT * FROM users WHERE id=$1", [user.id])).rows[0];
    fresh.isAdmin = config.ADMIN_EMAILS.includes(fresh.email);
    return { user: publicUser(fresh) };
  },

  "POST /api/auth/login": async (req, res) => {
    const user = await auth.login(await readJson(req, 10000), clientIp(req));
    await auth.createSession(res, req, user.id);
    user.isAdmin = config.ADMIN_EMAILS.includes(user.email);
    return { user: publicUser(user) };
  },

  "POST /api/auth/logout": async (req, res) => {
    await auth.logout(req, res);
    return { ok: true };
  },

  "GET /api/me": async (req) => {
    const u = await requireUser(req);
    db.q("UPDATE users SET last_seen_at=now() WHERE id=$1", [u.id]).catch(() => {});
    const refs = await db.q(
      "SELECT count(*)::int AS invited, count(*) FILTER (WHERE ref_rewarded)::int AS paid FROM users WHERE referred_by=$1",
      [u.id]
    );
    return { user: publicUser(u), referrals: refs.rows[0] };
  },

  "POST /api/me/lang": async (req) => {
    const u = await requireUser(req);
    const { lang } = await readJson(req, 1000);
    if (["ru", "es", "en"].includes(lang)) await db.q("UPDATE users SET lang=$2 WHERE id=$1", [u.id, lang]);
    return { ok: true };
  },

  "POST /api/me/password": async (req) => {
    const u = await requireUser(req);
    const { current, next } = await readJson(req, 2000);
    if (!(await auth.verifyPassword(String(current || ""), u.pass_hash))) throw auth.httpErr(401, "bad_login");
    if (String(next || "").length < 8) throw auth.httpErr(400, "short_password");
    await db.q("UPDATE users SET pass_hash=$2 WHERE id=$1", [u.id, await auth.hashPassword(next)]);
    return { ok: true };
  },

  // Право на удаление (ст. 17 RGPD): удаляем фото и сессии, анонимизируем аккаунт.
  // Записи об оплатах сохраняются — их требует налоговое и торговое законодательство.
  "POST /api/me/delete": async (req, res) => {
    const u = await requireUser(req);
    const { password } = await readJson(req, 2000);
    if (!(await auth.verifyPassword(String(password || ""), u.pass_hash))) throw auth.httpErr(401, "bad_login");
    await db.tx(async (c) => {
      await c.query("DELETE FROM jobs WHERE user_id=$1", [u.id]);
      await c.query("DELETE FROM sessions WHERE user_id=$1", [u.id]);
      await c.query(
        `UPDATE users SET email=$2, pass_hash='deleted', blocked=TRUE, credits=0, signup_ip=NULL, deleted_at=now() WHERE id=$1`,
        [u.id, `deleted-${u.id}-${crypto.randomBytes(4).toString("hex")}@deleted.invalid`]
      );
    });
    auth.clearSession(res, req);
    return { ok: true };
  },

  "POST /api/jobs": async (req) => {
    const u = await requireUser(req);
    if (!config.FAL_KEY) throw auth.httpErr(503, "not_configured");
    const b = await readJson(req);
    const preset = String(b.preset || "");
    if (!PRESETS.has(preset)) throw auth.httpErr(400, "bad_preset");
    const upscaleOnly = preset === "upscale";
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(b.image || "")) throw auth.httpErr(400, "bad_image");
    const thumb = /^data:image\/jpeg;base64,/.test(b.thumb || "") && b.thumb.length < 600000 ? b.thumb : null;
    const model = fal.EDIT_MODELS.has(b.model) ? b.model : "fal-ai/nano-banana-pro/edit";
    const resolution = ["1K", "2K", "4K"].includes(b.resolution) ? b.resolution : "2K";
    const prompt = String(b.prompt || "").slice(0, 4000);
    if (!upscaleOnly && prompt.length < 10) throw auth.httpErr(400, "bad_prompt");

    const cost = config.costOf({ upscaleOnly, resolution: model.includes("pro") ? resolution : "1K" });
    const id = crypto.randomUUID();
    const balance = await db.spendCredits(u.id, cost, "job", id);
    if (balance === null) throw auth.httpErr(402, "no_credits");

    const { rows } = await db.q(
      `INSERT INTO jobs(id, user_id, name, preset, model, resolution, upscale, cost, thumb)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, user_id, cost`,
      [id, u.id, String(b.name || "photo").slice(0, 120), preset, upscaleOnly ? null : model, resolution, !!b.upscale || upscaleOnly, cost, thumb]
    );
    runJob(rows[0], { image: b.image, prompt, model, resolution, upscale: !!b.upscale, upscaleOnly });
    return { id, credits: balance, cost };
  },

  "GET /api/jobs": async (req, res, { query }) => {
    const u = await requireUser(req);
    const limit = Math.min(Number(query.get("limit")) || 60, 200);
    const before = query.get("before");
    const { rows } = await db.q(
      `SELECT id, name, preset, model, resolution, upscale, cost, status, result_url, error, created_at, finished_at,
              (thumb IS NOT NULL) AS has_thumb
       FROM jobs WHERE user_id=$1 ${before ? "AND created_at < $3" : ""}
       ORDER BY created_at DESC LIMIT $2`,
      before ? [u.id, limit, before] : [u.id, limit]
    );
    return { jobs: rows };
  },
};

// маршруты с параметрами
async function dynamicRoute(method, pathname, req, res, query) {
  let m;
  if (method === "GET" && (m = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/))) {
    const u = await requireUser(req);
    const { rows } = await db.q(
      `SELECT id, name, preset, status, result_url, error, cost, created_at FROM jobs WHERE id=$1 AND user_id=$2`,
      [m[1], u.id]
    );
    if (!rows[0]) throw auth.httpErr(404, "not_found");
    const me = await db.q("SELECT credits FROM users WHERE id=$1", [u.id]);
    return send(res, 200, { job: rows[0], credits: me.rows[0].credits });
  }
  if (method === "GET" && (m = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})\/thumb$/))) {
    const u = await requireUser(req);
    const { rows } = await db.q("SELECT thumb FROM jobs WHERE id=$1 AND user_id=$2", [m[1], u.id]);
    const t = rows[0]?.thumb;
    if (!t) throw auth.httpErr(404, "not_found");
    const buf = Buffer.from(t.split(",")[1], "base64");
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": buf.length, "Cache-Control": "private, max-age=86400" });
    return res.end(buf);
  }
  if (method === "DELETE" && (m = pathname.match(/^\/api\/jobs\/([0-9a-f-]{36})$/))) {
    const u = await requireUser(req);
    await db.q("DELETE FROM jobs WHERE id=$1 AND user_id=$2 AND status IN ('done','failed')", [m[1], u.id]);
    return send(res, 200, { ok: true });
  }
  return false;
}

async function handleDownload(req, res, query) {
  await requireUser(req);
  const url = query.get("url");
  const name = (query.get("name") || "photo.jpg").replace(/[^\w.\-]/g, "_");
  let u;
  try { u = new URL(url); } catch { throw auth.httpErr(400, "bad_url"); }
  if (u.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.some((re) => re.test(u.hostname))) throw auth.httpErr(400, "bad_url");
  const r = await fetch(u).catch(() => null);
  if (!r || !r.ok) throw auth.httpErr(502, "download_failed");
  const buf = Buffer.from(await r.arrayBuffer());
  const headers = {
    "Content-Type": r.headers.get("content-type") || "image/jpeg",
    "Content-Length": buf.length,
    "Cache-Control": "private, max-age=86400",
  };
  if (query.get("inline") !== "1") headers["Content-Disposition"] = `attachment; filename="${name}"`;
  res.writeHead(200, headers);
  res.end(buf);
}

// ---------- демо на главной (генерируются из админки) ----------
const DEMO_PRESETS = new Set([...PRESETS].filter((p) => p !== "upscale"));
const DEMO_MAX_BYTES = 12 * 1024 * 1024;

function parseDataUrl(d) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(d || "");
  if (!m) return null;
  return { type: m[1], buf: Buffer.from(m[2], "base64") };
}

async function runDemo(id) {
  const { rows } = await db.q("SELECT * FROM demos WHERE id=$1", [id]);
  const d = rows[0];
  if (!d) return;
  try {
    if (!config.FAL_KEY) throw new Error("FAL_KEY не задан");
    const url = await fal.processPhoto({
      image: `data:${d.before_type};base64,${d.before_img.toString("base64")}`,
      prompt: d.prompt, model: d.model, resolution: d.resolution, upscale: false, upscaleOnly: false,
    });
    // сохраняем результат у себя — ссылки CDN fal могут истечь
    const r = await fetch(url);
    if (!r.ok) throw new Error("download " + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > DEMO_MAX_BYTES) throw new Error("result too large");
    await db.q(
      "UPDATE demos SET after_img=$2, after_type=$3, status='done', error=NULL, updated_at=now() WHERE id=$1",
      [id, buf, r.headers.get("content-type") || "image/jpeg"]
    );
  } catch (e) {
    console.error("demo failed", id, e.message);
    await db.q("UPDATE demos SET status='failed', error=$2, updated_at=now() WHERE id=$1", [id, e.message.slice(0, 300)]);
  }
}

async function demoRoute(method, pathname, req, res) {
  let m;
  // публичный список опубликованных демо
  if (method === "GET" && pathname === "/api/demos") {
    const { rows } = await db.q(
      `SELECT id, preset, extract(epoch from updated_at)::bigint AS v FROM demos
       WHERE published AND status='done' ORDER BY position, created_at LIMIT 6`
    );
    return send(res, 200, { demos: rows }, { "Cache-Control": "public, max-age=60" });
  }
  // картинки демо: публичные — только опубликованные, остальные — админу
  if (method === "GET" && (m = pathname.match(/^\/demo-img\/([0-9a-f-]{36})\/(before|after)$/))) {
    const col = m[2] === "before" ? "before" : "after";
    const { rows } = await db.q(`SELECT ${col}_img AS img, ${col}_type AS type, published FROM demos WHERE id=$1`, [m[1]]);
    const d = rows[0];
    if (!d || !d.img) throw auth.httpErr(404, "not_found");
    if (!d.published) await requireAdmin(req);
    res.writeHead(200, {
      "Content-Type": d.type, "Content-Length": d.img.length,
      "Cache-Control": d.published ? "public, max-age=86400" : "private, no-store",
    });
    return res.end(d.img);
  }
  if (!pathname.startsWith("/api/admin/demos")) return false;
  await requireAdmin(req);

  if (method === "GET" && pathname === "/api/admin/demos") {
    const { rows } = await db.q(
      `SELECT id, preset, status, error, published, position, created_at, extract(epoch from updated_at)::bigint AS v
       FROM demos ORDER BY position, created_at DESC`
    );
    return send(res, 200, { demos: rows });
  }
  if (method === "POST" && pathname === "/api/admin/demos") {
    const b = await readJson(req);
    const img = parseDataUrl(b.image);
    if (!img || img.buf.length > DEMO_MAX_BYTES) throw auth.httpErr(400, "bad_image");
    if (!DEMO_PRESETS.has(b.preset)) throw auth.httpErr(400, "bad_preset");
    const id = crypto.randomUUID();
    const pos = (await db.q("SELECT coalesce(max(position),0)+1 AS p FROM demos")).rows[0].p;
    await db.q(
      `INSERT INTO demos(id, preset, prompt, model, resolution, before_img, before_type, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, b.preset, String(b.prompt || "").slice(0, 4000),
       fal.EDIT_MODELS.has(b.model) ? b.model : "fal-ai/nano-banana-pro/edit",
       ["1K", "2K", "4K"].includes(b.resolution) ? b.resolution : "2K", img.buf, img.type, pos]
    );
    runDemo(id);
    return send(res, 200, { id });
  }
  if (method === "POST" && (m = pathname.match(/^\/api\/admin\/demos\/([0-9a-f-]{36})\/(regenerate|update)$/))) {
    if (m[2] === "regenerate") {
      await db.q("UPDATE demos SET status='running', error=NULL, updated_at=now() WHERE id=$1 AND status<>'running'", [m[1]]);
      runDemo(m[1]);
    } else {
      const b = await readJson(req, 2000);
      if (typeof b.published === "boolean") {
        await db.q("UPDATE demos SET published=$2, updated_at=now() WHERE id=$1 AND (status='done' OR $2=FALSE)", [m[1], b.published]);
      }
      if (Number.isInteger(b.position)) await db.q("UPDATE demos SET position=$2 WHERE id=$1", [m[1], b.position]);
    }
    return send(res, 200, { ok: true });
  }
  if (method === "DELETE" && (m = pathname.match(/^\/api\/admin\/demos\/([0-9a-f-]{36})$/))) {
    await db.q("DELETE FROM demos WHERE id=$1", [m[1]]);
    return send(res, 200, { ok: true });
  }
  return false;
}

// ---------- оплата ----------
async function handleCheckout(req, res) {
  const u = await requireUser(req);
  if (!config.STRIPE_SECRET_KEY) throw auth.httpErr(503, "payments_off");
  const { pack: packId, consent } = await readJson(req, 1000);
  // Явное согласие на немедленное начало услуги (ст. 103 TRLGDCU) — без него не продаём
  if (consent !== true) throw auth.httpErr(400, "consent_required");
  const pack = config.PACKS.find((p) => p.id === packId);
  if (!pack) throw auth.httpErr(400, "bad_pack");
  const session = await stripe.createCheckout({ user: u, pack, baseUrl: baseUrl(req) });
  send(res, 200, { url: session.url });
}

async function fulfill(session) {
  const userId = Number(session.metadata?.user_id || session.client_reference_id);
  const credits = Number(session.metadata?.credits);
  if (!userId || !credits) return console.error("webhook: нет user_id/credits", session.id);
  const credited = await db.tx(async (c) => {
    const ins = await c.query(
      `INSERT INTO payments(user_id, stripe_session, pack, credits, amount_cents, currency, consent_at, terms_version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (stripe_session) DO NOTHING RETURNING id`,
      [userId, session.id, session.metadata?.pack || "?", credits, session.amount_total || 0, session.currency || config.CURRENCY,
       session.metadata?.consent_at || null, session.metadata?.terms_version || null]
    );
    if (!ins.rows.length) return false; // уже начислено (повторный вебхук)
    await db.addCredits(userId, credits, "purchase", session.id, c);
    // Реферальный бонус пригласившему — один раз, после первой оплаты друга
    const r = await c.query(
      "UPDATE users SET ref_rewarded=TRUE WHERE id=$1 AND referred_by IS NOT NULL AND ref_rewarded=FALSE RETURNING referred_by",
      [userId]
    );
    if (r.rows[0] && config.REF_BONUS > 0) await db.addCredits(r.rows[0].referred_by, config.REF_BONUS, "ref_bonus", String(userId), c);
    return true;
  });
  if (credited) console.log(`Оплата: user ${userId} +${credits} кредитов (${session.id})`);
}

async function handleWebhook(req, res) {
  const raw = await readBody(req, 1024 * 1024);
  if (!stripe.verifyWebhook(raw, req.headers["stripe-signature"])) return send(res, 400, { error: "bad_signature" });
  const event = JSON.parse(raw);
  const s = event.data?.object;
  if (
    (event.type === "checkout.session.completed" && s.payment_status === "paid") ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    await fulfill(s);
  }
  send(res, 200, { received: true });
}

// ---------- админка ----------
const adminRoutes = {
  "GET /api/admin/stats": async () => {
    const [u, j, p, p30] = await Promise.all([
      db.q(`SELECT count(*)::int total, count(*) FILTER (WHERE created_at > now()-interval '7 days')::int week FROM users`),
      db.q(`SELECT count(*)::int total, count(*) FILTER (WHERE status='done')::int done,
                   count(*) FILTER (WHERE status='failed')::int failed,
                   count(*) FILTER (WHERE created_at > now()-interval '7 days')::int week FROM jobs`),
      db.q(`SELECT coalesce(sum(amount_cents),0)::int revenue, count(*)::int count, count(DISTINCT user_id)::int payers FROM payments`),
      db.q(`SELECT coalesce(sum(amount_cents),0)::int revenue FROM payments WHERE created_at > now()-interval '30 days'`),
    ]);
    return { users: u.rows[0], jobs: j.rows[0], payments: { ...p.rows[0], revenue30: p30.rows[0].revenue }, currency: config.CURRENCY };
  },
  "GET /api/admin/users": async (req, res, { query }) => {
    const s = (query.get("q") || "").trim().toLowerCase();
    const { rows } = await db.q(
      `SELECT u.id, u.email, u.credits, u.lang, u.blocked, u.created_at, u.last_seen_at,
              (SELECT count(*)::int FROM jobs WHERE user_id=u.id) jobs,
              (SELECT coalesce(sum(amount_cents),0)::int FROM payments WHERE user_id=u.id) paid,
              (SELECT email FROM users r WHERE r.id=u.referred_by) referred_by
       FROM users u ${s ? "WHERE u.email LIKE $1" : ""}
       ORDER BY u.created_at DESC LIMIT 200`,
      s ? [`%${s}%`] : []
    );
    return { users: rows };
  },
  "POST /api/admin/credits": async (req) => {
    const { userId, delta } = await readJson(req, 1000);
    const d = Math.trunc(Number(delta));
    if (!userId || !d) throw auth.httpErr(400, "bad_input");
    await db.tx((c) => db.addCredits(Number(userId), d, "admin", null, c));
    return { ok: true };
  },
  "POST /api/admin/block": async (req) => {
    const { userId, blocked } = await readJson(req, 1000);
    await db.q("UPDATE users SET blocked=$2 WHERE id=$1", [Number(userId), !!blocked]);
    if (blocked) await db.q("DELETE FROM sessions WHERE user_id=$1", [Number(userId)]);
    return { ok: true };
  },
  "POST /api/admin/password": async (req) => {
    const { userId, password } = await readJson(req, 1000);
    if (String(password || "").length < 8) throw auth.httpErr(400, "short_password");
    await db.q("UPDATE users SET pass_hash=$2 WHERE id=$1", [Number(userId), await auth.hashPassword(password)]);
    await db.q("DELETE FROM sessions WHERE user_id=$1", [Number(userId)]);
    return { ok: true };
  },
};

// ---------- статика ----------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};
const PAGES = {
  "/": "/index.html", "/app": "/app.html", "/admin": "/admin.html",
  "/legal": "/legal.html", "/aviso-legal": "/legal.html", "/privacidad": "/legal.html",
  "/condiciones": "/legal.html", "/cookies": "/legal.html",
};

function serveStatic(req, res, pathname) {
  const rel = PAGES[pathname] || pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      return res.end('<meta http-equiv="refresh" content="0;url=/">');
    }
    const ext = path.extname(file);
    // HTML/JS/CSS: браузер всегда перепроверяет (ETag) — после деплоя сразу свежая версия
    const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    const headers = {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": [".woff2", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".svg"].includes(ext) ? "public, max-age=604800" : "no-cache",
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    };
    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    fs.readFile(file, (e2, buf) => {
      if (e2) { res.writeHead(500); return res.end(); }
      res.writeHead(200, headers);
      res.end(buf);
    });
  });
}

// ---------- сервер ----------
const server = http.createServer(async (req, res) => {
  const { pathname, searchParams: query } = new URL(req.url, "http://x");
  const key = `${req.method} ${pathname}`;
  try {
    if (pathname === "/health") return send(res, 200, { ok: true });
    if (key === "POST /api/stripe/webhook") return await handleWebhook(req, res);
    if (key === "POST /api/checkout") return await handleCheckout(req, res);
    if (key === "GET /api/download") return await handleDownload(req, res, query);
    if (routes[key]) return send(res, 200, await routes[key](req, res, { query }));
    if (pathname === "/api/demos" || pathname.startsWith("/demo-img/") || pathname.startsWith("/api/admin/demos")) {
      if ((await demoRoute(req.method, pathname, req, res)) !== false) return;
      return send(res, 404, { error: "not_found" });
    }
    if (adminRoutes[key]) {
      await requireAdmin(req);
      return send(res, 200, await adminRoutes[key](req, res, { query }));
    }
    if (pathname.startsWith("/api/")) {
      const handled = await dynamicRoute(req.method, pathname, req, res, query);
      if (handled === false) send(res, 404, { error: "not_found" });
      return;
    }
    if (req.method === "GET") return serveStatic(req, res, pathname);
    send(res, 405, { error: "method_not_allowed" });
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.code || "server_error" });
  }
});

db.init()
  .then(() => {
    server.listen(config.PORT, () => {
      console.log(`${config.BRAND}: http://localhost:${config.PORT}`);
      if (!config.FAL_KEY) console.log("⚠ FAL_KEY не задан — обработка фото недоступна");
      if (!config.STRIPE_SECRET_KEY) console.log("⚠ STRIPE_SECRET_KEY не задан — оплата выключена");
      if (!config.ADMIN_EMAILS.length) console.log("⚠ ADMIN_EMAILS не задан — админка недоступна");
      const miss = ["name", "nif", "address", "email"].filter((k) => !config.LEGAL[k]);
      if (miss.length) console.log("⚠ Не заполнены данные владельца для Aviso legal:", miss.map((k) => "LEGAL_" + k.toUpperCase()).join(", "));
    });
  })
  .catch((e) => {
    console.error("Не удалось подключиться к базе:", e.message);
    process.exit(1);
  });
