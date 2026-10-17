import { db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { gameHistory, users } from '../schema.js';

const now = () => new Date();
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

async function changeBalance() {
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function debit() {
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function credit() {
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
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

export async function playSlot(userId, amount) {
  void userId;
  void amount;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function playPlinko(userId, amount) {
  void userId;
  void amount;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function wheelSpin(userId, amount) {
  void userId;
  void amount;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function dailyWheel(userId) {
  void userId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function crashStart(userId, amount) {
  void userId;
  void amount;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function crashStatus(userId) {
  void userId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}
export async function crashCashout(userId) {
  void userId;
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

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
