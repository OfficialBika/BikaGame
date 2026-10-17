import { db } from 'sdk';
import { desc, eq } from 'sdk/db';
import { gameHistory, users } from '../schema.js';

const now = () => new Date();
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const n = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

export async function userById(userId) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return db.select().from(users).where(eq(users.tgId, id)).get();
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
    set: {
      username: tgUser.username || null,
      firstName: tgUser.first_name || 'Player',
      lastName: tgUser.last_name || null,
      photoUrl: tgUser.photo_url || null,
      languageCode: tgUser.language_code || null,
      startedBot: true,
      updatedAt: t,
    },
  }).run();
  const user = await userById(id);
  if (!user) throw new Error('USER_UPSERT_FAILED');
  return user;
}

// The Serverless SDK surface currently used by this branch has no verified
// atomic balance + ledger settlement primitive. These wrappers intentionally
// fail closed so retries/crashes cannot make the balance diverge from history.
export async function debit() {
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function credit() {
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function recordGame(userId, game, bet, payout, result, multiplier = 0) {
  throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE');
}

export async function history(userId, game = 'all', limit = 20) {
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID_USER');
  const take = clamp(Math.floor(n(limit, 20)), 1, 100);
  const rows = await db.select().from(gameHistory)
    .where(eq(gameHistory.userId, id))
    .orderBy(desc(gameHistory.createdAt))
    .limit(take)
    .all();
  return game === 'all' ? rows : rows.filter((row) => row.game === game);
}

export async function playSlot() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function playPlinko() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function wheelSpin() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function dailyWheel() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function crashStart() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function crashStatus() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function crashCashout() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function minesStart() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function minesStatus() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function minesOpen() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function minesCashout() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function blackjackJoin() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function blackjackStatus() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function blackjackAction() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function shanCreate() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function shanJoin() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function shanStatus() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }
export async function shanDeal() { throw new Error('ATOMIC_SETTLEMENT_UNAVAILABLE'); }

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
