// Обработка фото через fal.ai (очередь), целиком на сервере
const config = require("./config");

const EDIT_MODELS = new Set(["fal-ai/nano-banana-pro/edit", "fal-ai/nano-banana/edit"]);
const UPSCALE_MODEL = "fal-ai/seedvr/upscale/image";
const FAL_BASE = process.env.FAL_QUEUE_BASE || "https://queue.fal.run"; // можно подменить для тестов

async function falFetch(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { Authorization: `Key ${config.FAL_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!r.ok) {
    const msg = data?.detail ? JSON.stringify(data.detail) : data?.raw || r.statusText;
    throw new Error(`fal.ai ${r.status}: ${msg}`.slice(0, 400));
  }
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(model, input, { timeoutMs = 6 * 60 * 1000 } = {}) {
  const sub = await falFetch(`${FAL_BASE}/${model}`, { method: "POST", body: JSON.stringify(input) });
  const started = Date.now();
  while (true) {
    await sleep(1500);
    const st = await falFetch(sub.status_url);
    if (st.status === "COMPLETED") return falFetch(sub.response_url);
    if (Date.now() - started > timeoutMs) throw new Error("timeout");
  }
}

// Полный пайплайн: правка (если нужна) → апскейл (если нужен). Возвращает URL результата.
async function processPhoto({ image, prompt, model, resolution, upscale, upscaleOnly }) {
  let url = image;
  if (!upscaleOnly) {
    if (!EDIT_MODELS.has(model)) throw new Error("bad_model");
    const input = { prompt, image_urls: [url], num_images: 1, output_format: "jpeg", aspect_ratio: "auto" };
    if (model.includes("pro")) input.resolution = ["1K", "2K", "4K"].includes(resolution) ? resolution : "2K";
    const out = await run(model, input);
    url = out?.images?.[0]?.url;
    if (!url) throw new Error("no_image");
  }
  if (upscale || upscaleOnly) {
    const out = await run(UPSCALE_MODEL, { image_url: url, upscale_mode: "factor", upscale_factor: 2, output_format: "jpg" });
    url = out?.image?.url || url;
  }
  return url;
}

module.exports = { processPhoto, EDIT_MODELS };
