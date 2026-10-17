import { db } from 'sdk';
import { and, desc, eq, gte, sql } from 'sdk/db';
import { gameHistory, gameSessions, transactions, users } from '../schema.js';

const MIN_BET = 1;
const MAX_BET = 1000000;
const now = () => new Date();
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const n = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
function betOf(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    throw new Error('INVALID_BET');
  }
  return amount;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export async function userById(userId) {
  return db.select().from(users).where(eq(users.tgId, Number(userId))).get();
}

export async function ensurePreviewUser(tgUser) {
  const id = Number(tgUser?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID_TELEGRAM_USER_ID');
  const t = now();
  await db.insert(users).values({
    tgId: id,
    username: tgUser.username || null,
    firstName: tgUser.first_name || 'Player',
    lastName: tgUser.last_name || null,
    photoUrl: tgUser.photo_url || null,
    languageCode: tgUser.language_code || null,
    balance: 0,
    totalWon: 0,
    totalLost: 0,
    isVip: false,
    startBonusClaimed: false,
    dailyClaimedAt: null,
    startedBot: true,
    createdAt: t,
    updatedAt: t,
  }).onConflictDoUpdate({
    target: users.tgId,
    set: { username: tgUser.username || null, firstName: tgUser.first_name || 'Player', lastName: tgUser.last_name || null, photoUrl: tgUser.photo_url || null, languageCode: tgUser.language_code || null, startedBot: true, updatedAt: t },
  }).run();
  return userById(id);
}

async function changeBalance(userId, delta, type, meta = {}, key = uid()) {
  const amount = Math.floor(n(delta));
  if (!Number.isSafeInteger(amount) || amount === 0) return userById(userId);
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('INVALID_USER');
  if (typeof key !== 'string' || !key || key.length > 200) throw new Error('IDEMPOTENCY_KEY_REQUIRED');

  const id = Number(userId);
  const existing = await db.select().from(transactions)
    .where(eq(transactions.idempotencyKey, key)).get();
  if (existing) {
    const same = existing.type === type && Number(existing.amount) === Math.abs(amount) &&
      String(existing.fromUserId || '') === (amount < 0 ? String(id) : '') &&
      String(existing.toUserId || '') === (amount > 0 ? String(id) : '');
    if (!same) throw new Error('IDEMPOTENCY_KEY_CONFLICT');
    return userById(id);
  }

  const t = now();
  const where = amount < 0
    ? and(eq(users.tgId, id), gte(users.balance, Math.abs(amount)))
    : eq(users.tgId, id);
  const changes = {
    balance: sql`${users.balance} + ${amount}`,
    updatedAt: t,
  };
  if (amount > 0) changes.totalWon = sql`${users.totalWon} + ${amount}`;
  if (amount < 0) changes.totalLost = sql`${users.totalLost} + ${Math.abs(amount)}`;

  // The platform preview SDK does not expose a verified multi-statement
  // transaction primitive here. Refuse real balance mutations rather than risk
  // balance/ledger divergence if the process stops between statements.
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function debit(userId, amount, type = 'bet', meta = {}, key) {
  return changeBalance(userId, -betOf(amount), type, meta, key);
}

export async function credit(userId, amount, type = 'win', meta = {}, key) {
  return changeBalance(userId, Math.max(0, Math.floor(n(amount))), type, meta, key);
}

export async function recordGame(userId, game, bet, payout, result, multiplier = 0) {
  await db.insert(gameHistory).values({ userId: Number(userId), game, bet: Math.floor(n(bet)), payout: Math.floor(n(payout)), multiplier: Math.floor(n(multiplier)), result, createdAt: now() }).run();
  return userById(userId);
}

export async function history(userId, game = 'all', limit = 20) {
  const take = clamp(Math.floor(n(limit, 20)), 1, 100);
  const q = db.select().from(gameHistory).where(eq(gameHistory.userId, Number(userId))).orderBy(desc(gameHistory.createdAt)).limit(take);
  const rows = await q.all();
  return game === 'all' ? rows : rows.filter((x) => x.game === game).slice(0, take);
}

async function activeSession(userId, game) {
  return db.select().from(gameSessions).where(and(eq(gameSessions.userId, Number(userId)), eq(gameSessions.game, game), eq(gameSessions.status, 'active'))).get();
}

async function createSession(userId, game, state) {
  const t = now();
  const id = uid();
  await db.insert(gameSessions).values({ id, userId: Number(userId), game, status: 'active', state, createdAt: t, updatedAt: t }).run();
  return db.select().from(gameSessions).where(eq(gameSessions.id, id)).get();
}

async function updateSession(id, state, status = 'active') {
  await db.update(gameSessions).set({ state, status, updatedAt: now() }).where(eq(gameSessions.id, id)).run();
  return db.select().from(gameSessions).where(eq(gameSessions.id, id)).get();
}

async function settleSession(id, status) {
  const result = await db.update(gameSessions).set({ status, updatedAt: now() })
    .where(and(eq(gameSessions.id, id), eq(gameSessions.status, 'active'))).run();
  return Boolean(result?.rowsAffected);
}

function weighted(items) {
  const total = items.reduce((a, x) => a + x.w, 0);
  let r = Math.random() * total;
  for (const x of items) { r -= x.w; if (r < 0) return x.v; }
  return items[items.length - 1].v;
}

const slotSymbols = ['🍒','🍋','🍉','🔔','⭐','BAR','7'];
const slotPays = { '7,7,7':20, 'BAR,BAR,BAR':15, '⭐,⭐,⭐':12, '🔔,🔔,🔔':9, '🍉,🍉,🍉':7, '🍋,🍋,🍋':5, '🍒,🍒,🍒':3 };
function slotSpin() {
  const reels = [0,1,2].map(() => weighted(slotSymbols.map((v, i) => ({ v, w: [3200,2200,1500,900,450,200,100][i] }))));
  const key = reels.join(',');
  let multiplier = slotPays[key] || 0;
  if (!multiplier && new Set(reels).size === 2) multiplier = 1.5;
  return { reels, multiplier, payoutMultiplier: multiplier };
}

export async function playSlot(userId, amount) {
  const bet = betOf(amount);
  await debit(userId, bet, 'slot_bet', { game: 'slot' }, `slot:${userId}:${uid()}`);
  const result = slotSpin();
  const payout = Math.floor(bet * result.multiplier);
  if (payout) await credit(userId, payout, 'slot_win', { game: 'slot', reels: result.reels }, `slot-win:${userId}:${uid()}`);
  const user = await recordGame(userId, 'slot', bet, payout, result.reels, result.multiplier);
  return { ok: true, game: 'slot', reels: result.reels, multiplier: result.multiplier, payout, balance: user.balance };
}

export async function playPlinko(userId, amount) {
  const bet = betOf(amount);
  await debit(userId, bet, 'plinko_bet', { game: 'plinko' }, `plinko:${userId}:${uid()}`);
  const multipliers = [0,0.5,0.8,1,1.2,1.5,2,3,5,10];
  const multiplier = weighted(multipliers.map((v) => ({ v, w: v === 0 ? 12 : v >= 5 ? 1 : 8 })));
  const payout = Math.floor(bet * multiplier);
  if (payout) await credit(userId, payout, 'plinko_win', { game: 'plinko', multiplier }, `plinko-win:${userId}:${uid()}`);
  const user = await recordGame(userId, 'plinko', bet, payout, { multiplier }, multiplier);
  return { ok: true, game: 'plinko', multiplier, payout, balance: user.balance };
}

const wheelSegments = [0, 50, 100, 250, 500, 1000, 2500, 5000];
export async function wheelSpin(userId, amount) {
  const bet = betOf(amount);
  await debit(userId, bet, 'wheel_bet', { game: 'wheel' }, `wheel:${userId}:${uid()}`);
  const reward = weighted(wheelSegments.map((v) => ({ v, w: v >= 2500 ? 1 : 6 })));
  const payout = Math.floor(bet * reward / 100);
  if (payout) await credit(userId, payout, 'wheel_win', { game: 'wheel', reward }, `wheel-win:${userId}:${uid()}`);
  const user = await recordGame(userId, 'wheel', bet, payout, { reward }, reward);
  return { ok: true, game: 'wheel', reward, payout, balance: user.balance, segments: wheelSegments };
}

export async function dailyWheel(userId) {
  void userId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

function crashPoint() { return Math.max(1.01, Math.floor((1.01 + Math.random() * Math.random() * 7) * 100) / 100); }
export async function crashStart(userId, amount) {
  const bet = betOf(amount);
  if (await activeSession(userId, 'crash')) throw new Error('CRASH_RUNNING');
  await debit(userId, bet, 'crash_bet', { game: 'crash' }, `crash:${userId}:${uid()}`);
  const session = await createSession(userId, 'crash', { bet, point: crashPoint(), startedAt: Date.now(), cashedOut: false });
  return { ok: true, sessionId: session.id, phase: 'running', multiplier: 1, balance: (await userById(userId)).balance };
}
export async function crashStatus(userId) {
  void userId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function crashCashout(userId) {
  void userId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

function minesLayout(count = 3) { const set = new Set(); while (set.size < count) set.add(Math.floor(Math.random() * 25)); return [...set]; }
export async function minesStart(userId, amount) {
  void userId;
  void amount;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function minesStatus(userId) { const s = await activeSession(userId, 'mines'); const u = await userById(userId); return s ? { ok:true, active:true, opened:s.state.opened, multiplier:s.state.multiplier, balance:u.balance } : { ok:true, active:false, balance:u?.balance||0 }; }
export async function minesOpen(userId, index) {
  void userId;
  void index;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function minesCashout(userId) {
  void userId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

function deck() { const suits=['♠','♥','♦','♣']; const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K']; return suits.flatMap(s=>ranks.map(r=>({r,s}))).sort(()=>Math.random()-0.5); }
function cardValue(cards) { let total=0, aces=0; for(const c of cards){ if(c.r==='A'){total+=11;aces++;} else total += ['K','Q','J'].includes(c.r)?10:Number(c.r); } while(total>21&&aces--) total-=10; return total; }
export async function blackjackJoin(userId, roomId, amount) {
  void userId;
  void roomId;
  void amount;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function blackjackStatus(userId, roomId) {
  void userId;
  void roomId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function blackjackAction(userId, roomId, action) {
  void userId;
  void roomId;
  void action;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

function shanCards() { const d=deck(); return [d.pop(),d.pop(),d.pop()]; }
export async function shanCreate(userId, title = 'Bika Shan Koe Mee Pro Table') {
  void userId;
  void title;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function shanJoin(userId, roomId, amount) {
  void userId;
  void roomId;
  void amount;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function shanStatus(userId, roomId) {
  void userId;
  void roomId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function shanDeal(userId, roomId, action = 'deal') {
  void userId;
  void roomId;
  void action;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function config() {
  return {
    ok: true,
    coin: '$',
    games: ['crash', 'slot', 'blackjack', 'shan', 'plinko', 'wheel', 'mines'],
    serverless: true,
    productionDataImported: false,
    liveEconomyEnabled: false,
    disabledReason: 'ATOMIC_SETTLEMENT_UNAVAILABLE',
  };
}
