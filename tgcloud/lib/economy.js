import { db, EndpointError } from 'sdk';
import { and, eq, isNull } from 'sdk/db';
import { users, transactions, treasury, settings, idempotencyKeys, userCooldowns, broadcastJobs, broadcastTargets } from '../schema.js';
import { walletIdForUserId, walletSuffix } from './walletPolicy.js';
import { dailyRewardAmount, yangonDayBounds } from './dailyPolicy.js';
import { buildDuelSettlementRow } from './duelSettlementPlan.js';

const now = () => new Date();
const token = () => Math.random().toString(36).slice(2, 10);
let setupPromise = null;
let lastCleanup = 0;

function userIdOf(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new EndpointError('Invalid Telegram user ID.', { code: 'INVALID_USER' });
  return n;
}
function amountOf(value, code = 'INVALID_AMOUNT') {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isSafeInteger(n) || n <= 0) throw new EndpointError('Amount must be a positive whole number.', { code });
  return n;
}
function safeText(value, limit = 256) {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, limit) : null;
}

const triggerSql = [
`CREATE TRIGGER IF NOT EXISTS bika_transactions_before_insert
BEFORE INSERT ON transactions
BEGIN
  SELECT RAISE(IGNORE)
    WHERE NEW.idempotency_key IS NOT NULL
      AND EXISTS (SELECT 1 FROM idempotency_keys WHERE key = NEW.idempotency_key);
  SELECT CASE WHEN NEW.account_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users WHERE tg_id = NEW.account_user_id)
    THEN RAISE(ABORT, 'USER_NOT_FOUND') END;
  SELECT CASE WHEN NEW.account_user_id IS NOT NULL
      AND COALESCE(NEW.required_balance, 0) > 0
      AND COALESCE((SELECT balance FROM users WHERE tg_id = NEW.account_user_id), -1) < NEW.required_balance
    THEN RAISE(ABORT, 'USER_INSUFFICIENT') END;
  SELECT CASE WHEN NEW.from_account_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users WHERE tg_id = NEW.from_account_user_id)
    THEN RAISE(ABORT, 'SENDER_NOT_FOUND') END;
  SELECT CASE WHEN NEW.from_account_user_id IS NOT NULL
      AND COALESCE((SELECT balance FROM users WHERE tg_id = NEW.from_account_user_id), -1) < NEW.amount
    THEN RAISE(ABORT, 'USER_INSUFFICIENT') END;
  SELECT CASE WHEN NEW.to_account_user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM users WHERE tg_id = NEW.to_account_user_id)
    THEN RAISE(ABORT, 'RECIPIENT_NOT_FOUND') END;
  SELECT CASE WHEN COALESCE(NEW.required_treasury, 0) > 0
      AND COALESCE((SELECT owner_balance FROM treasury WHERE key = 'treasury'), 0) < NEW.required_treasury
    THEN RAISE(ABORT, 'TREASURY_INSUFFICIENT') END;
  SELECT CASE WHEN NEW.type = 'daily_claim'
      AND COALESCE((SELECT daily_claimed_at FROM users WHERE tg_id = NEW.account_user_id), 0) >=
          CAST(json_extract(NEW.meta, '$.dayStartUnix') AS INTEGER)
    THEN RAISE(ABORT, 'DAILY_ALREADY_CLAIMED') END;
  SELECT CASE WHEN NEW.payouts IS NOT NULL
      AND EXISTS (SELECT 1 FROM json_each(NEW.payouts) p
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE tg_id = CAST(json_extract(p.value, '$.userId') AS INTEGER)))
    THEN RAISE(ABORT, 'PAYOUT_USER_NOT_FOUND') END;
END`,
`CREATE TRIGGER IF NOT EXISTS bika_transactions_after_insert
AFTER INSERT ON transactions
BEGIN
  UPDATE users SET
    balance = balance + COALESCE(NEW.balance_delta, 0),
    total_won = total_won + COALESCE(NEW.total_won_delta, 0),
    total_lost = total_lost + COALESCE(NEW.total_lost_delta, 0),
    updated_at = NEW.created_at
    WHERE tg_id = NEW.account_user_id AND NEW.balance_delta IS NOT NULL;
  UPDATE treasury SET
    owner_balance = owner_balance + COALESCE(NEW.treasury_delta, 0),
    updated_at = NEW.created_at
    WHERE key = 'treasury' AND NEW.treasury_delta IS NOT NULL;
  UPDATE users SET daily_claimed_at = NEW.created_at, updated_at = NEW.created_at
    WHERE tg_id = NEW.account_user_id AND NEW.type = 'daily_claim';
  UPDATE users SET balance = balance - NEW.amount,
    total_lost = total_lost + CASE WHEN NEW.type = 'gift' THEN 0 ELSE NEW.amount END,
    updated_at = NEW.created_at
    WHERE tg_id = NEW.from_account_user_id;
  UPDATE users SET balance = balance + NEW.amount,
    total_won = total_won + CASE WHEN NEW.type = 'gift' THEN 0 ELSE NEW.amount END,
    updated_at = NEW.created_at
    WHERE tg_id = NEW.to_account_user_id;
  UPDATE users SET
    balance = balance + COALESCE((SELECT SUM(CAST(json_extract(p.value, '$.amount') AS INTEGER)) FROM json_each(NEW.payouts) p WHERE CAST(json_extract(p.value, '$.userId') AS INTEGER) = users.tg_id), 0),
    total_won = total_won + COALESCE((SELECT SUM(CAST(json_extract(p.value, '$.amount') AS INTEGER)) FROM json_each(NEW.payouts) p WHERE CAST(json_extract(p.value, '$.userId') AS INTEGER) = users.tg_id), 0),
    updated_at = NEW.created_at
    WHERE NEW.payouts IS NOT NULL AND tg_id IN (SELECT CAST(json_extract(p.value, '$.userId') AS INTEGER) FROM json_each(NEW.payouts) p);
  INSERT INTO game_history(user_id, game, bet, payout, multiplier, result, title, outcome, net, settlement_id, created_at)
    SELECT NEW.history_user_id, NEW.game_key, COALESCE(NEW.bet_amount, 0), COALESCE(NEW.payout_amount, 0),
      COALESCE(NEW.multiplier, 0), NEW.game_result, json_extract(NEW.meta, '$.title'),
      json_extract(NEW.meta, '$.outcome'), COALESCE(NEW.payout_amount, 0) - COALESCE(NEW.bet_amount, 0),
      NEW.idempotency_key, NEW.created_at
    WHERE NEW.history_user_id IS NOT NULL AND NEW.game_key IS NOT NULL;
  INSERT INTO game_history(user_id, game, bet, payout, multiplier, result, title, outcome, net, settlement_id, created_at)
    SELECT CAST(json_extract(h.value, '$.userId') AS INTEGER), json_extract(h.value, '$.game'),
      COALESCE(CAST(json_extract(h.value, '$.bet') AS INTEGER), 0),
      COALESCE(CAST(json_extract(h.value, '$.payout') AS INTEGER), 0),
      COALESCE(CAST(json_extract(h.value, '$.multiplier') AS REAL), 0), json_extract(h.value, '$.result'),
      json_extract(h.value, '$.title'), json_extract(h.value, '$.outcome'),
      COALESCE(CAST(json_extract(h.value, '$.payout') AS INTEGER), 0) - COALESCE(CAST(json_extract(h.value, '$.bet') AS INTEGER), 0),
      NEW.idempotency_key, NEW.created_at
    FROM json_each(NEW.histories) h WHERE NEW.histories IS NOT NULL;
  INSERT OR IGNORE INTO payment_events(id, user_id, stars, amount, status, payload, telegram_payment_charge_id, invoice_payload, created_at, updated_at)
    SELECT COALESCE(json_extract(NEW.meta, '$.chargeId'), NEW.idempotency_key), NEW.account_user_id,
      COALESCE(CAST(json_extract(NEW.meta, '$.stars') AS INTEGER), 0), COALESCE(NEW.payout_amount, 0),
      'completed', NEW.meta, json_extract(NEW.meta, '$.chargeId'), json_extract(NEW.meta, '$.invoicePayload'), NEW.created_at, NEW.created_at
    WHERE NEW.type = 'stars_bal_purchase';
  INSERT OR IGNORE INTO idempotency_keys(key, kind, user_id, created_at)
    SELECT NEW.idempotency_key, NEW.type,
      COALESCE(NEW.account_user_id, NEW.from_account_user_id, NEW.to_account_user_id, NEW.history_user_id),
      NEW.created_at WHERE NEW.idempotency_key IS NOT NULL AND NEW.type <> 'game_history';
END`,
];

const refundTriggerSql = [
`CREATE TRIGGER IF NOT EXISTS bika_transactions_refunds_before_insert
BEFORE INSERT ON transactions
BEGIN
  SELECT CASE WHEN NEW.refunds IS NOT NULL
      AND EXISTS (SELECT 1 FROM json_each(NEW.refunds) r
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE tg_id = CAST(json_extract(r.value, '$.userId') AS INTEGER)))
    THEN RAISE(ABORT, 'REFUND_USER_NOT_FOUND') END;
END`,
`CREATE TRIGGER IF NOT EXISTS bika_transactions_refunds_after_insert
AFTER INSERT ON transactions
BEGIN
  UPDATE users SET
    balance = balance + COALESCE((SELECT SUM(CAST(json_extract(r.value, '$.amount') AS INTEGER)) FROM json_each(NEW.refunds) r WHERE CAST(json_extract(r.value, '$.userId') AS INTEGER) = users.tg_id), 0),
    updated_at = NEW.created_at
    WHERE NEW.refunds IS NOT NULL AND tg_id IN (SELECT CAST(json_extract(r.value, '$.userId') AS INTEGER) FROM json_each(NEW.refunds) r);
END`,
];

const twoDTriggerSql = [
`CREATE TRIGGER IF NOT EXISTS bika_transactions_two_d_before_insert
BEFORE INSERT ON transactions
WHEN NEW.type = 'two_d_bet'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM two_d_events
    WHERE id = json_extract(NEW.meta, '$.eventId')
      AND status = 'open'
      AND close_at > unixepoch()
  ) THEN RAISE(ABORT, 'TWO_D_CLOSED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.meta, '$.lines') line
    WHERE COALESCE((
      SELECT amount FROM two_d_positions
      WHERE id = json_extract(NEW.meta, '$.eventId') || ':' || NEW.account_user_id || ':' ||
        json_extract(line.value, '$.number')
    ), 0) + CAST(json_extract(line.value, '$.amount') AS INTEGER) > 200000
  ) THEN RAISE(ABORT, 'TWO_D_NUMBER_LIMIT') END;
END`,
`CREATE TRIGGER IF NOT EXISTS bika_transactions_two_d_after_insert
AFTER INSERT ON transactions
WHEN NEW.type = 'two_d_bet'
BEGIN
  INSERT INTO two_d_bets (
    id, event_id, user_id, number, amount, potential_win, status, data, created_at, updated_at
  )
  SELECT NEW.idempotency_key || ':' || json_extract(line.value, '$.number'),
    json_extract(NEW.meta, '$.eventId'), NEW.account_user_id,
    json_extract(line.value, '$.number'),
    CAST(json_extract(line.value, '$.amount') AS INTEGER),
    CAST(json_extract(line.value, '$.potentialWin') AS INTEGER),
    'pending', NEW.meta, NEW.created_at, NEW.created_at
  FROM json_each(NEW.meta, '$.lines') line;

  INSERT INTO two_d_positions (
    id, event_id, user_id, number, amount, data, updated_at
  )
  SELECT json_extract(NEW.meta, '$.eventId') || ':' || NEW.account_user_id || ':' ||
      json_extract(line.value, '$.number'),
    json_extract(NEW.meta, '$.eventId'), NEW.account_user_id,
    json_extract(line.value, '$.number'),
    CAST(json_extract(line.value, '$.amount') AS INTEGER),
    NEW.meta, NEW.created_at
  FROM json_each(NEW.meta, '$.lines') line
  WHERE NEW.type = 'two_d_bet'
  ON CONFLICT(id) DO UPDATE SET
    amount = two_d_positions.amount + excluded.amount,
    data = excluded.data,
    updated_at = excluded.updated_at;
END`,
];

async function setup() {
  await db.run("INSERT OR IGNORE INTO treasury(key, owner_balance, vip_win_rate, maintenance, updated_at) VALUES('treasury', 0, 90, 0, unixepoch())");
  await db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_cards_bot_card_unique ON shop_cards(bot_key, card_id) WHERE bot_key IS NOT NULL AND card_id IS NOT NULL");
  await db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_active_crash_mines_per_user ON game_sessions(user_id, game) WHERE status = 'active' AND game IN ('crash', 'mines')");
  for (const sqlText of triggerSql) await db.run(sqlText);
  for (const sqlText of refundTriggerSql) await db.run(sqlText);
  for (const sqlText of twoDTriggerSql) await db.run(sqlText);
}
async function cleanup() {
  const ms = Date.now();
  if (ms - lastCleanup < 3600000) return;
  lastCleanup = ms;
  const cutoff = Math.floor(ms / 1000) - 259200;
  await db.run('DELETE FROM game_history WHERE created_at < :cutoff', { ':cutoff': cutoff });
  await db.run('DELETE FROM transactions WHERE created_at < :cutoff', { ':cutoff': cutoff });
  await db.run("DELETE FROM game_sessions WHERE updated_at < :cutoff AND status IN ('settled','lost','finished','expired','cancelled')", { ':cutoff': cutoff });
  await db.run("DELETE FROM two_d_bets WHERE updated_at < :cutoff AND status IN ('settled','won','lost','cancelled','refunded')", { ':cutoff': cutoff });
  await db.run("DELETE FROM two_d_positions WHERE updated_at < :cutoff AND event_id IN (SELECT id FROM two_d_events WHERE status IN ('result','cancelled'))", { ':cutoff': cutoff });
  await db.run("DELETE FROM two_d_events WHERE created_at < :cutoff AND status IN ('result','cancelled')", { ':cutoff': cutoff });
  await db.run("DELETE FROM sports_bets WHERE updated_at < :cutoff AND status IN ('settled','won','lost','cancelled','refunded')", { ':cutoff': cutoff });
  await db.run("DELETE FROM auction_bids WHERE created_at < :cutoff AND auction_id IN (SELECT auction_id FROM auctions WHERE status IN ('settled','closed','cancelled','completed'))", { ':cutoff': cutoff });
  await db.run("DELETE FROM orders WHERE updated_at < :cutoff AND status IN ('completed','cancelled','rejected','expired','sold')", { ':cutoff': cutoff });
  await db.run("DELETE FROM sell_orders WHERE updated_at < :cutoff AND status IN ('completed','cancelled','rejected','expired','sold')", { ':cutoff': cutoff });
  await db.run("UPDATE payment_events SET payload = NULL, stars = 0, amount = 0, invoice_payload = NULL, status = 'dedupe_only', updated_at = unixepoch() WHERE created_at < :cutoff AND payload IS NOT NULL", { ':cutoff': cutoff });
  await db.run("UPDATE broadcast_jobs SET status = 'expired', payload = NULL, updated_at = unixepoch() WHERE created_at < :cutoff AND status IN ('pending', 'running', 'paused', 'cancel_requested')", { ':cutoff': cutoff });
  await db.run("DELETE FROM broadcast_targets WHERE created_at < :cutoff", { ':cutoff': cutoff });
  await db.run("DELETE FROM broadcast_jobs WHERE created_at < :cutoff AND status IN ('completed', 'cancelled', 'failed', 'expired')", { ':cutoff': cutoff });
}
export async function ensureEconomy() {
  if (!setupPromise) setupPromise = setup().catch((e) => { setupPromise = null; throw e; });
  await setupPromise;
  await cleanup();
}

export async function userById(value) {
  await ensureEconomy();
  const id = userIdOf(value);
  return db.select().from(users).where(eq(users.tgId, id)).get();
}
export async function getUserByUsername(username) {
  await ensureEconomy();
  const name = String(username || '').replace(/^@/, '').toLowerCase();
  if (!name) return null;
  return db.select().from(users).where(eq(users.username, name)).get();
}
export async function ensureUser(tgUser) {
  await ensureEconomy();
  const id = userIdOf(tgUser?.id ?? tgUser?.userId);
  const username = safeText(tgUser?.username)?.toLowerCase() || null;
  const firstName = safeText(tgUser?.first_name ?? tgUser?.firstName) || 'Player';
  const lastName = safeText(tgUser?.last_name ?? tgUser?.lastName);
  const photoUrl = safeText(tgUser?.photo_url ?? tgUser?.photoUrl);
  const languageCode = safeText(tgUser?.language_code ?? tgUser?.languageCode);
  const prior = await db.select().from(users).where(eq(users.tgId, id)).get();
  // Keep wallet IDs stable once assigned. For new users, retry unique collisions;
  // for legacy rows with NULL IDs, set only if another invocation has not won.
  let walletId = prior?.walletId || null;
  let inserted = false;
  for (let attempt = 0; attempt < 8 && !inserted; attempt += 1) {
    const candidate = walletId || walletIdForUserId(id, walletSuffix());
    try {
      await db.insert(users).values({
        tgId: id, username, firstName, lastName, photoUrl, languageCode, walletId: candidate,
        balance: 0, totalWon: 0, totalLost: 0, isVip: false, isBanned: false,
        startBonusClaimed: false, dailyClaimedAt: null, startedBot: true, createdAt: now(), updatedAt: now(),
      }).onConflictDoUpdate({
        target: users.tgId,
        set: { username, firstName, lastName, photoUrl, languageCode, startedBot: true, updatedAt: now() },
      }).run();
      inserted = true;
      walletId = candidate;
    } catch (error) {
      const message = String(error?.message || error);
      if (walletId || !/unique|constraint|sqlite_constraint/i.test(message) || attempt === 7) throw error;
    }
  }
  let user = await db.select().from(users).where(eq(users.tgId, id)).get();
  if (!user) throw new EndpointError('USER_UPSERT_FAILED', { code: 'USER_UPSERT_FAILED' });
  if (!user.walletId) {
    let assigned = false;
    for (let attempt = 0; attempt < 8 && !assigned; attempt += 1) {
      const candidate = walletIdForUserId(id, walletSuffix());
      try {
        await db.update(users).set({ walletId: candidate, updatedAt: now() })
          .where(and(eq(users.tgId, id), isNull(users.walletId))).run();
      } catch (error) {
        const message = String(error?.message || error);
        if (!/unique|constraint|sqlite_constraint/i.test(message) || attempt === 7) throw error;
      }
      user = await db.select().from(users).where(eq(users.tgId, id)).get();
      assigned = Boolean(user?.walletId);
    }
  }
  if (!user?.walletId) throw new EndpointError('WALLET_ID_ASSIGNMENT_FAILED', { code: 'WALLET_ID_ASSIGNMENT_FAILED' });
  return user;
}

async function insertOperation(row) {
  await ensureEconomy();
  const key = String(row.idempotencyKey || ('op:' + Date.now() + ':' + token())).slice(0, 180);
  try {
    const inserted = await db.insert(transactions).values({ ...row, idempotencyKey: key, createdAt: row.createdAt || now() }).onConflictDoNothing().returning().run();
    const ok = Array.isArray(inserted) ? inserted.length > 0 : Boolean(inserted?.rowsAffected);
    if (ok) return { ok: true, duplicate: false, key, row: Array.isArray(inserted) ? inserted[0] : inserted?.rows?.[0] || null };
    const existing = await db.select().from(transactions).where(eq(transactions.idempotencyKey, key)).get();
    return { ok: true, duplicate: true, key, row: existing || null };
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('USER_INSUFFICIENT')) throw new EndpointError('Balance မလုံလောက်ပါ။', { code: 'USER_INSUFFICIENT' });
    if (msg.includes('TREASURY_INSUFFICIENT')) throw new EndpointError('Bot Bank balance မလုံလောက်ပါ။', { code: 'TREASURY_INSUFFICIENT' });
    if (msg.includes('USER_NOT_FOUND') || msg.includes('RECIPIENT_NOT_FOUND')) throw new EndpointError('User data မတွေ့ပါ။', { code: 'USER_NOT_FOUND' });
    if (msg.includes('TWO_D_CLOSED')) throw new EndpointError('2D ထိုးကြေးပိတ်ထားပါပြီ။', { code: 'TWO_D_CLOSED' });
    if (msg.includes('TWO_D_NUMBER_LIMIT')) throw new EndpointError('ဒီဂဏန်းကို တစ်ဦးလျှင် 200,000 Bal ထက်ပို၍ မထိုးနိုင်ပါ။', { code: 'TWO_D_NUMBER_LIMIT' });
    throw err;
  }
}
export async function settleSingleGame({ settlementId, typePrefix, userId, bet = 0, payout = 0, meta = {}, game = null, result = null, multiplier = 0 }) {
  const id = userIdOf(userId), b = Number(bet), p = Number(payout);
  if (!settlementId || !typePrefix || !Number.isSafeInteger(b) || b < 0 || !Number.isSafeInteger(p) || p < 0) throw new EndpointError('Invalid game settlement.', { code: 'INVALID_GAME_SETTLEMENT' });
  const key = '__settlement:' + typePrefix + ':' + String(settlementId);
  const op = await insertOperation({
    type: typePrefix + '_settlement', fromUserId: String(id), toUserId: 'TREASURY', amount: Math.max(1, b, p),
    accountUserId: id, balanceDelta: p - b, requiredBalance: b, totalWonDelta: p, totalLostDelta: b,
    treasuryDelta: b - p, requiredTreasury: Math.max(0, p - b), betAmount: b, payoutAmount: p,
    multiplier: Number(multiplier) || 0, gameKey: game, historyUserId: game ? id : null, gameResult: result,
    idempotencyKey: key,
    meta: { ...meta, settlementId: String(settlementId), bet: b, payout: p, game },
  });
  const stored = op.row;
  return { ok: true, duplicate: op.duplicate, payout: Number(stored?.payoutAmount ?? p), bet: Number(stored?.betAmount ?? b), balance: Number((await db.select().from(users).where(eq(users.tgId, id)).get())?.balance || 0), meta: stored?.meta || { ...meta, bet: b, payout: p, game, result, multiplier } };
}
export async function settleDuel({ settlementId, typePrefix = 'dice', challengerId, targetUserId, winnerUserId = null, bet, payout = 0, meta = {} }) {
  const row = buildDuelSettlementRow({
    settlementId, typePrefix, challengerId, targetUserId, winnerUserId, bet, payout, meta,
  });
  const op = await insertOperation(row);
  const stored = op.row;
  return {
    ok: true,
    duplicate: op.duplicate,
    winnerUserId: stored?.meta?.winnerUserId ?? row.meta.winnerUserId,
    result: stored?.meta?.result ?? row.meta.result,
    payout: Number(stored?.meta?.payout ?? row.meta.payout),
    settlementId: String(settlementId),
  };
}

export async function settleAward({ idempotencyKey, userId, amount, type = 'reward', meta = {}, game = null, result = null }) {
  const id = userIdOf(userId), reward = amountOf(amount);
  const op = await insertOperation({
    type, fromUserId: 'TREASURY', toUserId: String(id), amount: reward,
    accountUserId: id, balanceDelta: reward, requiredBalance: 0, totalWonDelta: reward, totalLostDelta: 0,
    treasuryDelta: -reward, requiredTreasury: reward, betAmount: 0, payoutAmount: reward,
    gameKey: game, historyUserId: game ? id : null, gameResult: result,
    idempotencyKey: idempotencyKey || (type + ':' + id + ':' + new Date().toISOString().slice(0, 10)),
    meta: { ...meta, reward, game },
  });
  return { ok: true, duplicate: op.duplicate, reward, balance: Number((await db.select().from(users).where(eq(users.tgId, id)).get())?.balance || 0), idempotencyKey: op.key };
}
export async function debit(userId, amount, type = 'bet', meta = {}, key) {
  const id = userIdOf(userId), n = amountOf(amount, 'INVALID_BET');
  await insertOperation({
    type, fromUserId: String(id), toUserId: 'TREASURY', amount: n,
    accountUserId: id, balanceDelta: -n, requiredBalance: n, totalWonDelta: 0, totalLostDelta: n,
    treasuryDelta: n, requiredTreasury: 0, betAmount: n, payoutAmount: 0,
    idempotencyKey: key || (type + ':' + id + ':' + Date.now() + ':' + token()), meta,
  });
  return db.select().from(users).where(eq(users.tgId, id)).get();
}
export async function credit(userId, amount, type = 'win', meta = {}, key) {
  const id = userIdOf(userId), n = amountOf(amount);
  await insertOperation({
    type, fromUserId: 'TREASURY', toUserId: String(id), amount: n,
    accountUserId: id, balanceDelta: n, requiredBalance: 0, totalWonDelta: n, totalLostDelta: 0,
    treasuryDelta: -n, requiredTreasury: n, betAmount: 0, payoutAmount: n,
    idempotencyKey: key || (type + ':' + id + ':' + Date.now() + ':' + token()), meta,
  });
  return db.select().from(users).where(eq(users.tgId, id)).get();
}
export async function claimDailyReward(userId) {
  await ensureEconomy();
  const id = userIdOf(userId);
  const user = await db.select().from(users).where(eq(users.tgId, id)).get();
  if (!user) throw new EndpointError('User data မတွေ့ပါ။', { code: 'USER_NOT_FOUND' });

  const { dayKey, dayStartUnix } = yangonDayBounds(now());
  const key = 'daily-claim:' + id + ':' + dayKey;
  const prior = await getTransaction(key);
  if (prior) {
    const current = await db.select().from(users).where(eq(users.tgId, id)).get();
    return { ok: true, duplicate: true, dayKey, reward: Number(prior.payoutAmount || prior.amount || 0), balance: Number(current?.balance || 0) };
  }
  if (await hasIdempotencyKey(key)) {
    throw new EndpointError('ဒီနေ့ claim လုပ်ပြီးပါပြီ။ နောက်နေ့မှ ပြန်လုပ်ပါ။', { code: 'DAILY_ALREADY_CLAIMED' });
  }

  const min = Number(await getSetting('daily_reward_min', 500));
  const max = Number(await getSetting('daily_reward_max', 2000));
  let reward;
  try {
    reward = dailyRewardAmount(min, max);
  } catch (_) {
    throw new EndpointError('Daily reward setting မမှန်ပါ။', { code: 'DAILY_CONFIG_INVALID' });
  }

  let operation;
  try {
    operation = await insertOperation({
      type: 'daily_claim',
      fromUserId: 'TREASURY',
      toUserId: String(id),
      amount: reward,
      accountUserId: id,
      balanceDelta: reward,
      requiredBalance: 0,
      totalWonDelta: 0,
      totalLostDelta: 0,
      treasuryDelta: -reward,
      requiredTreasury: reward,
      betAmount: 0,
      payoutAmount: reward,
      idempotencyKey: key,
      meta: { source: 'telegram_daily', dayKey, dayStartUnix },
    });
  } catch (error) {
    const code = String(error?.code || error?.message || error);
    if (code.includes('DAILY_ALREADY_CLAIMED')) {
      throw new EndpointError('ဒီနေ့ claim လုပ်ပြီးပါပြီ။ နောက်နေ့မှ ပြန်လုပ်ပါ။', { code: 'DAILY_ALREADY_CLAIMED' });
    }
    throw error;
  }

  if (operation.duplicate && !operation.row) {
    throw new EndpointError('ဒီနေ့ claim လုပ်ပြီးပါပြီ။ နောက်နေ့မှ ပြန်လုပ်ပါ။', { code: 'DAILY_ALREADY_CLAIMED' });
  }
  const current = await db.select().from(users).where(eq(users.tgId, id)).get();
  return {
    ok: true,
    duplicate: Boolean(operation.duplicate),
    dayKey,
    reward: Number(operation.row?.payoutAmount || operation.row?.amount || reward),
    balance: Number(current?.balance || 0),
  };
}

export async function transferBalance(fromUserId, toUserId, amount, meta = {}, key) {
  const from = userIdOf(fromUserId), to = userIdOf(toUserId), n = amountOf(amount, 'INVALID_TRANSFER');
  if (from === to) throw new EndpointError('မိမိကိုယ်တိုင်ထံ လွှဲမရပါ။', { code: 'TRANSFER_SELF' });
  const op = await insertOperation({
    type: 'gift', fromUserId: String(from), toUserId: String(to),
    fromAccountUserId: from, toAccountUserId: to, amount: n,
    idempotencyKey: key || ('gift:' + from + ':' + Date.now() + ':' + token()),
    meta: { source: 'mini_wallet', ...meta },
  });
  return { ok: true, duplicate: op.duplicate, amount: n, sender: await db.select().from(users).where(eq(users.tgId, from)).get(), recipient: await db.select().from(users).where(eq(users.tgId, to)).get() };
}
export async function transferByWalletId(fromUserId, walletId, amount, meta = {}, key) {
  await ensureEconomy();
  const target = await db.select().from(users).where(eq(users.walletId, String(walletId || '').trim())).get();
  if (!target) throw new EndpointError('ဒီ Wallet ID ပိုင်ရှင်ကို မတွေ့ပါ။', { code: 'WALLET_NOT_FOUND' });
  return transferBalance(fromUserId, target.tgId, amount, meta, key);
}
export async function placeTwoDBet({ eventId, userId, lines, total, sourceChatId, sourceMessageId, display = [] }) {
  await ensureEconomy();
  const id = userIdOf(userId);
  if (!eventId || !Array.isArray(lines) || !lines.length) {
    throw new EndpointError('Invalid 2D bet.', { code: 'TWO_D_BET_INVALID' });
  }
  const amount = amountOf(total, 'TWO_D_BET_INVALID');
  const safeLines = lines.map((line) => {
    const number = String(line?.number || '');
    const lineAmount = amountOf(line?.amount, 'TWO_D_BET_INVALID');
    if (!/^\\d{2}$/.test(number) || !Number.isSafeInteger(lineAmount) || lineAmount > 200000) {
      throw new EndpointError('Invalid 2D number or amount.', { code: 'TWO_D_BET_INVALID' });
    }
    return { number, amount: lineAmount, potentialWin: lineAmount * 40 };
  });
  if (safeLines.reduce((sum, line) => sum + line.amount, 0) !== amount) {
    throw new EndpointError('2D bet total does not match line amounts.', { code: 'TWO_D_BET_INVALID' });
  }
  const key = '__settlement:2d-bet:' + String(eventId) + ':' + String(sourceChatId) + ':' + String(sourceMessageId);
  const op = await insertOperation({
    type: 'two_d_bet',
    fromUserId: String(id),
    toUserId: 'TREASURY',
    amount,
    accountUserId: id,
    balanceDelta: -amount,
    requiredBalance: amount,
    totalWonDelta: 0,
    totalLostDelta: amount,
    treasuryDelta: amount,
    requiredTreasury: 0,
    betAmount: amount,
    payoutAmount: 0,
    idempotencyKey: key,
    meta: {
      eventId: String(eventId),
      lines: safeLines,
      total: amount,
      display: Array.isArray(display) ? display : [],
      sourceChatId: String(sourceChatId),
      sourceMessageId: String(sourceMessageId),
    },
  });
  const user = await db.select().from(users).where(eq(users.tgId, id)).get();
  return { ok: true, duplicate: op.duplicate, total: amount, balance: Number(user?.balance || 0), idempotencyKey: op.key };
}

export async function settleMultiPayouts({ settlementId, typePrefix, payouts = [], meta = {}, histories = [] }) {
  if (!settlementId || !typePrefix || !Array.isArray(payouts)) throw new EndpointError('Invalid multi payout.', { code: 'INVALID_MULTI_SETTLEMENT' });
  const values = payouts.map((p) => ({ userId: userIdOf(p.userId), amount: amountOf(p.amount) }));
  const total = values.reduce((sum, p) => sum + p.amount, 0);
  const op = await insertOperation({
    type: typePrefix + '_multi_settlement', amount: Math.max(1, total), payouts: values, histories,
    treasuryDelta: -total, requiredTreasury: total,
    idempotencyKey: '__settlement:' + typePrefix + ':' + String(settlementId), meta: { ...meta, payouts: values, settlementId },
  });
  return { ok: true, duplicate: op.duplicate, paid: values };
}
export async function getTreasury() {
  await ensureEconomy();
  return db.select().from(treasury).where(eq(treasury.key, 'treasury')).get();
}
export async function getSetting(key, fallback = null) {
  await ensureEconomy();
  const row = await db.select().from(settings).where(eq(settings.key, String(key))).get();
  return row?.value == null ? fallback : row.value;
}
export async function setSetting(key, value) {
  await ensureEconomy();
  return db.insert(settings).values({ key: String(key), value, updatedAt: now() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now() } }).run();
}
export async function consumeCooldown(userId, action, cooldownMs) {
  await ensureEconomy();
  const id = userIdOf(userId), ms = Date.now(), cooldown = Math.max(0, Number(cooldownMs) || 0), key = id + ':' + action;
  const result = await db.run(
    'INSERT INTO user_cooldowns(id,user_id,action,last_used_at) VALUES(:id,:uid,:action,:now) ' +
    'ON CONFLICT(id) DO UPDATE SET last_used_at=excluded.last_used_at ' +
    'WHERE user_cooldowns.last_used_at <= excluded.last_used_at - :cooldown RETURNING last_used_at',
    { ':id': key, ':uid': id, ':action': String(action), ':now': ms, ':cooldown': cooldown },
  );
  if (!(result?.rows || []).length) {
    const row = await db.select().from(userCooldowns).where(eq(userCooldowns.id, key)).get();
    const remaining = Math.max(0, cooldown - (ms - Number(row?.lastUsedAt || ms)));
    throw new EndpointError('Cooldown ခဏစောင့်ပါ။', { code: 'COOLDOWN', cooldownLeft: Math.ceil(remaining / 1000) });
  }
  return true;
}
export async function getTransaction(key) {
  await ensureEconomy();
  return db.select().from(transactions).where(eq(transactions.idempotencyKey, String(key))).get();
}

export async function hasIdempotencyKey(key) {
  await ensureEconomy();
  return Boolean(await db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, String(key))).get());
}

export async function recordGame({ userId, game, bet = 0, payout = 0, result = null, multiplier = 0, key = null, meta = {} }) {
  const id = userIdOf(userId);
  const b = Math.max(0, Math.floor(Number(bet) || 0));
  const p = Math.max(0, Math.floor(Number(payout) || 0));
  const settlementKey = String(key || ('history:' + game + ':' + id + ':' + Date.now() + ':' + token()));
  return insertOperation({
    type: 'game_history',
    amount: 0,
    idempotencyKey: settlementKey,
    gameKey: String(game || 'unknown'),
    historyUserId: id,
    betAmount: b,
    payoutAmount: p,
    multiplier: Number(multiplier) || 0,
    gameResult: result,
    meta: { ...meta, title: meta.title || String(game || 'Game'), outcome: meta.outcome || (p > b ? 'win' : p > 0 ? 'paid' : 'lose') },
  });
}

export async function creditExternalPurchase({ idempotencyKey, userId, amount, type = 'external_purchase', source = 'external', meta = {} }) {
  const id = userIdOf(userId);
  const creditAmount = amountOf(amount);
  const key = String(idempotencyKey || '').trim();
  if (!key) throw new EndpointError('An idempotency key is required for external credits.', { code: 'IDEMPOTENCY_REQUIRED' });
  const op = await insertOperation({
    type, fromUserId: String(source), toUserId: String(id), amount: creditAmount,
    accountUserId: id, balanceDelta: creditAmount, requiredBalance: 0,
    totalWonDelta: 0, totalLostDelta: 0,
    // Paid-in funds are not house-funded rewards.
    treasuryDelta: creditAmount, requiredTreasury: 0,
    betAmount: 0, payoutAmount: creditAmount, idempotencyKey: key, meta,
  });
  const user = await db.select().from(users).where(eq(users.tgId, id)).get();
  return { ok: true, duplicate: op.duplicate, amount: creditAmount, balance: Number(user?.balance || 0), idempotencyKey: op.key };
}

export async function getUserByWalletId(walletId) {
  await ensureEconomy();
  const value = String(walletId || '').trim();
  if (!value) return null;
  return db.select().from(users).where(eq(users.walletId, value)).get();
}
