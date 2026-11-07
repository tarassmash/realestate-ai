const crypto = require("crypto");
const { promisify } = require("util");
const db = require("./db");
const config = require("./config");

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 60;
const COOKIE = "sid";

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}
async function verifyPassword(pw, stored) {
  const [, saltHex, keyHex] = String(stored).split("$");
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(pw, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const refCode = () => crypto.randomBytes(5).toString("base64url").replace(/[-_]/g, "x").slice(0, 7).toLowerCase();

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function isSecure(req) {
  return (req.headers["x-forwarded-proto"] || "").includes("https");
}

async function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.q("INSERT INTO sessions(token_hash, user_id, expires_at) VALUES ($1,$2,$3)", [sha(token), userId, expires]);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isSecure(req) ? "; Secure" : ""}`
  );
}

function clearSession(res, req) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(req) ? "; Secure" : ""}`);
}

async function getUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const { rows } = await db.q(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha(token)]
  );
  const u = rows[0];
  if (!u || u.blocked) return null;
  u.isAdmin = config.ADMIN_EMAILS.includes(u.email);
  return u;
}

async function logout(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) await db.q("DELETE FROM sessions WHERE token_hash = $1", [sha(token)]);
  clearSession(res, req);
}

// --- простая защита от перебора и массовых регистраций (в памяти) ---
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of hits) if (!arr.some((t) => now - t < 864e5)) hits.delete(k);
}, 36e5).unref();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function register({ email, password, lang, ref }, ip) {
  email = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw httpErr(400, "bad_email");
  if (String(password || "").length < 8) throw httpErr(400, "short_password");
  if (!rateLimit("reg:" + ip, 3, 864e5)) throw httpErr(429, "too_many");

  const exists = await db.q("SELECT 1 FROM users WHERE email = $1", [email]);
  if (exists.rows.length) throw httpErr(409, "email_taken");

  let referrer = null;
  if (ref) {
    const r = await db.q("SELECT id, signup_ip FROM users WHERE ref_code = $1", [String(ref).toLowerCase()]);
    // бонус не даём, если «друг» регистрируется с того же IP
    if (r.rows[0] && r.rows[0].signup_ip !== ip) referrer = r.rows[0].id;
  }

  const hash = await hashPassword(password);
  return db.tx(async (c) => {
    let user;
    for (let i = 0; i < 5 && !user; i++) {
      try {
        const { rows } = await c.query(
          `INSERT INTO users(email, pass_hash, lang, ref_code, referred_by, signup_ip)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [email, hash, ["ru", "es", "en"].includes(lang) ? lang : "en", refCode(), referrer, ip]
        );
        user = rows[0];
      } catch (e) {
        if (e.code !== "23505" || /email/.test(e.detail || "")) throw e; // повтор только при коллизии ref_code
      }
    }
    if (config.FREE_CREDITS > 0) await db.addCredits(user.id, config.FREE_CREDITS, "welcome", null, c);
    if (referrer && config.REF_WELCOME > 0) await db.addCredits(user.id, config.REF_WELCOME, "ref_welcome", String(referrer), c);
    return user;
  });
}

async function login({ email, password }, ip) {
  email = String(email || "").trim().toLowerCase();
  if (!rateLimit("login:" + ip, 20, 15 * 6e4) || !rateLimit("login:" + email, 10, 15 * 6e4))
    throw httpErr(429, "too_many");
  const { rows } = await db.q("SELECT * FROM users WHERE email = $1", [email]);
  const u = rows[0];
  if (!u || !(await verifyPassword(String(password || ""), u.pass_hash))) throw httpErr(401, "bad_login");
  if (u.blocked) throw httpErr(403, "blocked");
  return u;
}

function httpErr(status, code) {
  const e = new Error(code);
  e.status = status;
  e.code = code;
  return e;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  clearSession,
  getUser,
  logout,
  register,
  login,
  rateLimit,
  httpErr,
};
