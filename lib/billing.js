// Подписка и доступ к обработке.
// Правило: активная подписка → до SUB_WEEKLY_LIMIT фото за текущий период; иначе — бесплатные кредиты (пробные 3 фото).
const db = require("./db");
const config = require("./config");

const ACTIVE_STRIPE = new Set(["active", "trialing", "past_due"]);
const toDate = (sec) => (sec ? new Date(Number(sec) * 1000) : null);

function subscriptionOf(u) {
  const active = !!u.sub_expires_at && new Date(u.sub_expires_at) > new Date() && u.sub_status !== "expired";
  return {
    active,
    provider: u.sub_provider || null,
    status: u.sub_status || null,
    periodStart: u.sub_period_start || null,
    expiresAt: u.sub_expires_at || null,
    cancelAtPeriodEnd: !!u.sub_cancel_at_period_end,
  };
}

async function usedThisPeriod(userId, periodStart, client = db.pool) {
  if (!periodStart) return 0;
  const { rows } = await client.query(
    `SELECT coalesce(sum(cost),0)::int AS used FROM jobs
     WHERE user_id=$1 AND billing='sub' AND status <> 'failed' AND created_at >= $2`,
    [userId, periodStart]
  );
  return rows[0].used;
}

// Что доступно пользователю прямо сейчас (для /api/me и интерфейса)
async function entitlement(u) {
  const sub = subscriptionOf(u);
  const used = sub.active ? await usedThisPeriod(u.id, sub.periodStart) : 0;
  const limit = config.SUB_WEEKLY_LIMIT;
  return {
    subscription: sub,
    usage: { used, limit, remaining: sub.active ? Math.max(0, limit - used) : 0 },
    credits: u.credits,
    canProcess: (sub.active && used < limit) || u.credits > 0,
  };
}

// Резервирование одной обработки: внутри транзакции, с блокировкой строки пользователя (без гонок)
async function reserve(c, userId, cost) {
  const u = (await c.query("SELECT * FROM users WHERE id=$1 FOR UPDATE", [userId])).rows[0];
  const sub = subscriptionOf(u);
  if (sub.active) {
    const used = await usedThisPeriod(userId, sub.periodStart, c);
    if (used + cost <= config.SUB_WEEKLY_LIMIT) return { billing: "sub" };
  }
  if (u.credits >= cost) {
    await c.query("UPDATE users SET credits=credits-$1 WHERE id=$2", [cost, userId]);
    await c.query("INSERT INTO ledger(user_id, delta, reason) VALUES ($1,$2,'job')", [userId, -cost]);
    return { billing: "credits" };
  }
  const e = new Error(sub.active ? "limit_reached" : "subscription_required");
  e.status = 402;
  e.code = e.message;
  throw e;
}

// ---------- Stripe ----------
function stripePeriod(sub) {
  const item = sub.items?.data?.[0] || {};
  return {
    start: toDate(sub.current_period_start ?? item.current_period_start),
    end: toDate(sub.current_period_end ?? item.current_period_end),
  };
}

async function syncStripeSubscription(sub, userIdHint) {
  if (!sub || !sub.id) return null;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  let userId = Number(sub.metadata?.user_id || userIdHint) || null;
  if (!userId) {
    const r = await db.q("SELECT id FROM users WHERE stripe_subscription_id=$1 OR (stripe_customer_id=$2 AND $2 IS NOT NULL) LIMIT 1", [sub.id, customer || null]);
    userId = r.rows[0]?.id || null;
  }
  if (!userId) {
    console.error("stripe sub без пользователя:", sub.id);
    return null;
  }
  const { start, end } = stripePeriod(sub);
  const ended = toDate(sub.ended_at);
  const active = ACTIVE_STRIPE.has(sub.status);
  const expires = active ? end : ended || end || new Date();
  // не перетираем действующую подписку Apple более ранней датой
  await db.q(
    `UPDATE users SET
       stripe_customer_id = coalesce($2, stripe_customer_id),
       stripe_subscription_id = $3,
       sub_provider = CASE WHEN sub_provider='apple' AND sub_expires_at > $5 THEN sub_provider ELSE 'stripe' END,
       sub_status = CASE WHEN sub_provider='apple' AND sub_expires_at > $5 THEN sub_status ELSE $4 END,
       sub_expires_at = CASE WHEN sub_provider='apple' AND sub_expires_at > $5 THEN sub_expires_at ELSE $5 END,
       sub_period_start = CASE WHEN sub_provider='apple' AND sub_expires_at > $5 THEN sub_period_start ELSE $6 END,
       sub_cancel_at_period_end = CASE WHEN sub_provider='apple' AND sub_expires_at > $5 THEN sub_cancel_at_period_end ELSE $7 END
     WHERE id=$1`,
    [userId, customer || null, sub.id, active ? sub.status : "expired", expires, start, !!sub.cancel_at_period_end]
  );
  return userId;
}

// Запись оплаты по счёту подписки (для выручки и истории покупок клиента)
async function recordStripeInvoice(inv, userId) {
  if (!userId || !inv?.id || !(inv.amount_paid > 0)) return;
  const pi = typeof inv.payment_intent === "string" ? inv.payment_intent : inv.payment_intent?.id || null;
  await db.q(
    `INSERT INTO payments(user_id, stripe_session, payment_intent, provider, pack, credits, amount_cents, currency, invoice_url, invoice_pdf)
     VALUES ($1,$2,$3,'stripe','weekly',0,$4,$5,$6,$7) ON CONFLICT (stripe_session) DO NOTHING`,
    [userId, `inv:${inv.id}`, pi, inv.amount_paid, inv.currency || config.SUB_CURRENCY, inv.hosted_invoice_url || null, inv.invoice_pdf || null]
  );
}

// ---------- Apple ----------
async function applyAppleSubscription(userId, tx, renewal) {
  const expires = tx.revocationDate ? new Date(tx.revocationDate) : new Date(Number(tx.expiresDate || 0));
  const start = new Date(Number(tx.purchaseDate || Date.now()));
  const cancelAtEnd = renewal ? Number(renewal.autoRenewStatus) === 0 : null;
  await db.q(
    `UPDATE users SET
       apple_original_tx = $2,
       sub_provider = CASE WHEN sub_provider='stripe' AND sub_expires_at > $3 AND $3 > now() THEN sub_provider ELSE 'apple' END,
       sub_status = CASE WHEN sub_provider='stripe' AND sub_expires_at > $3 AND $3 > now() THEN sub_status ELSE $5 END,
       sub_period_start = CASE WHEN sub_provider='stripe' AND sub_expires_at > $3 AND $3 > now() THEN sub_period_start ELSE $4 END,
       sub_cancel_at_period_end = CASE WHEN sub_provider='stripe' AND sub_expires_at > $3 AND $3 > now() THEN sub_cancel_at_period_end
                                       ELSE coalesce($6, sub_cancel_at_period_end) END,
       sub_expires_at = CASE WHEN sub_provider='stripe' AND sub_expires_at > $3 AND $3 > now() THEN sub_expires_at ELSE $3 END
     WHERE id=$1`,
    [userId, String(tx.originalTransactionId), expires, start, tx.revocationDate ? "expired" : "active", cancelAtEnd]
  );
  // оплата за период (для выручки); возврат отмечаем суммой
  const amount = Math.round((tx.price || 0) / 10);
  await db.q(
    `INSERT INTO payments(user_id, stripe_session, payment_intent, provider, environment, pack, credits, amount_cents, currency, refunded_cents)
     VALUES ($1,$2,$2,'apple',$3,'weekly',0,$4,$5,$6)
     ON CONFLICT (stripe_session) DO UPDATE SET refunded_cents = GREATEST(payments.refunded_cents, EXCLUDED.refunded_cents)`,
    [userId, `apple:${tx.transactionId}`, tx.environment || null, amount, String(tx.currency || "usd").toLowerCase(), tx.revocationDate ? amount : 0]
  );
}

module.exports = {
  subscriptionOf, entitlement, reserve, usedThisPeriod,
  syncStripeSubscription, recordStripeInvoice, applyAppleSubscription, stripePeriod,
};
