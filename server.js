// Realty Photo AI — небольшой сервер-прокси к fal.ai
// Ключ FAL_KEY хранится на сервере и не попадает в браузер.
// Запуск: FAL_KEY=xxx node server.js   (Node 18+)

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const FAL_KEY = process.env.FAL_KEY || "";
// Необязательный пароль на вход (HTTP Basic). Логин любой, пароль = APP_PASSWORD.
const APP_PASSWORD = process.env.APP_PASSWORD || "";
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY = 40 * 1024 * 1024; // 40 MB (фото приходят как data URI)

// Разрешённые модели (чтобы сервер нельзя было использовать для чего угодно)
const ALLOWED_MODELS = new Set([
  "fal-ai/nano-banana-pro/edit", // качество (Gemini 3 Pro Image)
  "fal-ai/nano-banana/edit",     // быстрее и дешевле
  "fal-ai/seedvr/upscale/image", // апскейл SeedVR2
]);

const ALLOWED_DOWNLOAD_HOSTS = [/\.fal\.media$/, /^fal\.media$/, /^storage\.googleapis\.com$/];

// request_id -> { status_url, response_url, key, created }
const jobs = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, j] of jobs) if (j.created < cutoff) jobs.delete(id);
}, 10 * 60 * 1000).unref();

function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("Файл слишком большой"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function keyFor(req) {
  // Ключ с сервера приоритетнее; если его нет — берём из заголовка (локальный режим)
  return FAL_KEY || (req.headers["x-fal-key"] || "").toString().trim();
}

async function falFetch(url, key, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Key ${key}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.detail ? JSON.stringify(data.detail) : data?.raw || r.statusText;
    const err = new Error(`fal.ai ${r.status}: ${msg}`.slice(0, 500));
    err.status = r.status;
    throw err;
  }
  return data;
}

async function handleSubmit(req, res) {
  const key = keyFor(req);
  if (!key) return send(res, 401, { error: "Не задан ключ fal.ai (FAL_KEY)" });
  const { model, input } = JSON.parse(await readBody(req));
  if (!ALLOWED_MODELS.has(model)) return send(res, 400, { error: "Модель не разрешена" });
  if (!input || typeof input !== "object") return send(res, 400, { error: "Нет input" });

  const data = await falFetch(`https://queue.fal.run/${model}`, key, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const id = crypto.randomUUID();
  jobs.set(id, {
    status_url: data.status_url,
    response_url: data.response_url,
    key,
    created: Date.now(),
  });
  send(res, 200, { id });
}

async function handleStatus(req, res, id) {
  const job = jobs.get(id);
  if (!job) return send(res, 404, { error: "Задача не найдена" });
  const st = await falFetch(job.status_url, job.key);
  if (st.status === "COMPLETED") {
    const result = await falFetch(job.response_url, job.key);
    jobs.delete(id);
    return send(res, 200, { status: "COMPLETED", result });
  }
  send(res, 200, { status: st.status, position: st.queue_position ?? null });
}

async function handleDownload(req, res, query) {
  const url = query.get("url");
  const name = (query.get("name") || "photo.jpg").replace(/[^\w.\-]/g, "_");
  let u;
  try { u = new URL(url); } catch { return send(res, 400, { error: "Плохой URL" }); }
  if (u.protocol !== "https:" || !ALLOWED_DOWNLOAD_HOSTS.some((re) => re.test(u.hostname)))
    return send(res, 400, { error: "Хост не разрешён" });
  const r = await fetch(u);
  if (!r.ok) return send(res, 502, { error: "Не удалось скачать" });
  const buf = Buffer.from(await r.arrayBuffer());
  const headers = {
    "Content-Type": r.headers.get("content-type") || "application/octet-stream",
    "Content-Length": buf.length,
    "Cache-Control": "private, max-age=3600",
  };
  if (query.get("inline") !== "1") headers["Content-Disposition"] = `attachment; filename="${name}"`;
  res.writeHead(200, headers);
  res.end(buf);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: "forbidden" });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}

function checkAuth(req) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const pass = Buffer.from(h.slice(6), "base64").toString("utf8").split(":").slice(1).join(":");
  const a = Buffer.from(pass), b = Buffer.from(APP_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url, "http://x");
  if (pathname === "/health") return send(res, 200, { ok: true });
  if (APP_PASSWORD && !checkAuth(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Realty Photo AI", charset="UTF-8"' });
    return res.end("Auth required");
  }
  try {
    if (req.method === "GET" && pathname === "/api/config")
      return send(res, 200, { serverKey: Boolean(FAL_KEY) });
    if (req.method === "POST" && pathname === "/api/submit") return await handleSubmit(req, res);
    if (req.method === "GET" && pathname.startsWith("/api/status/"))
      return await handleStatus(req, res, pathname.split("/").pop());
    if (req.method === "GET" && pathname === "/api/download")
      return await handleDownload(req, res, searchParams);
    if (req.method === "GET") return serveStatic(req, res, pathname);
    send(res, 405, { error: "method not allowed" });
  } catch (e) {
    console.error(e);
    send(res, e.status && e.status < 600 ? e.status : 500, { error: e.message || "Ошибка сервера" });
  }
});

server.listen(PORT, () => {
  console.log(`Realty Photo AI: http://localhost:${PORT}`);
  if (!FAL_KEY) console.log("FAL_KEY не задан — ключ можно ввести в интерфейсе (локальный режим).");
});
