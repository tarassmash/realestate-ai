const { Pool } = require("pg");
const config = require("./config");

if (!config.DATABASE_URL) {
  console.error("DATABASE_URL не задан. Добавьте Postgres (на Railway: + New → Database → PostgreSQL).");
}

const isLocal = /localhost|127\.0\.0\.1|\.railway\.internal/.test(config.DATABASE_URL);
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  pass_hash     TEXT NOT NULL,
  credits       INTEGER NOT NULL DEFAULT 0,
  lang          TEXT NOT NULL DEFAULT 'en',
  ref_code      TEXT NOT NULL UNIQUE,
  referred_by   INTEGER REFERENCES users(id),
  ref_rewarded  BOOLEAN NOT NULL DEFAULT FALSE,
  blocked       BOOLEAN NOT NULL DEFAULT FALSE,
  signup_ip     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS ledger (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  ref         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id);

CREATE TABLE IF NOT EXISTS jobs (
  id           UUID PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT,
  preset       TEXT NOT NULL,
  model        TEXT,
  resolution   TEXT,
  upscale      BOOLEAN NOT NULL DEFAULT FALSE,
  cost         INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued',
  result_url   TEXT,
  error        TEXT,
  thumb        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS jobs_user_created ON jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_session  TEXT NOT NULL UNIQUE,
  pack            TEXT NOT NULL,
  credits         INTEGER NOT NULL,
  amount_cents    INTEGER NOT NULL,
  currency        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS payments_user ON payments(user_id);
`;

async function init() {
  await pool.query(SCHEMA);
  // Задачи, оборванные перезапуском сервера: помечаем ошибкой и возвращаем кредиты
  const { rows } = await pool.query(
    `UPDATE jobs SET status='failed', error='Server restarted', finished_at=now()
     WHERE status IN ('queued','running') RETURNING id, user_id, cost`
  );
  for (const j of rows) await addCredits(j.user_id, j.cost, "refund", j.id);
  if (rows.length) console.log(`Возвращены кредиты за ${rows.length} прерванных задач`);
}

const q = (text, params) => pool.query(text, params);

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const r = await fn(client);
    await client.query("COMMIT");
    return r;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function addCredits(userId, delta, reason, ref, client = pool) {
  await client.query("UPDATE users SET credits = credits + $1 WHERE id = $2", [delta, userId]);
  await client.query("INSERT INTO ledger(user_id, delta, reason, ref) VALUES ($1,$2,$3,$4)", [
    userId,
    delta,
    reason,
    ref || null,
  ]);
}

// Атомарное списание: вернёт новый баланс или null, если кредитов не хватает
async function spendCredits(userId, amount, reason, ref) {
  return tx(async (c) => {
    const { rows } = await c.query(
      "UPDATE users SET credits = credits - $1 WHERE id = $2 AND credits >= $1 RETURNING credits",
      [amount, userId]
    );
    if (!rows.length) return null;
    await c.query("INSERT INTO ledger(user_id, delta, reason, ref) VALUES ($1,$2,$3,$4)", [
      userId,
      -amount,
      reason,
      ref || null,
    ]);
    return rows[0].credits;
  });
}

module.exports = { pool, q, tx, init, addCredits, spendCredits };
