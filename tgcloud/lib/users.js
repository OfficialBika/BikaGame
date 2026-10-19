import { db } from 'sdk';
import { and, asc, desc, eq, isNull } from 'sdk/db';
import { walletIdForUserId, walletSuffix } from './walletPolicy.js';
import { users } from '../schema.js';

function optionalText(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, 256) : null;
}

export async function ensureUser(telegramUser) {
  const tgId = Number(telegramUser?.id);
  if (!Number.isSafeInteger(tgId) || tgId <= 0) {
    throw new Error('INVALID_TELEGRAM_USER_ID');
  }

  const now = new Date();
  const username = optionalText(telegramUser.username);
  const firstName = optionalText(telegramUser.first_name ?? telegramUser.firstName) || 'Player';
  const lastName = optionalText(telegramUser.last_name ?? telegramUser.lastName);
  const photoUrl = optionalText(telegramUser.photo_url ?? telegramUser.photoUrl);
  const languageCode = optionalText(telegramUser.language_code ?? telegramUser.languageCode);

  // On conflict, update profile metadata only. Never reset or overwrite a balance.
  await db.insert(users).values({
    tgId,
    username,
    firstName,
    lastName,
    photoUrl,
    languageCode,
    balance: 0,
    totalWon: 0,
    totalLost: 0,
    isVip: false,
    startBonusClaimed: false,
    dailyClaimedAt: null,
    startedBot: true,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: users.tgId,
    set: {
      username,
      firstName,
      lastName,
      photoUrl,
      languageCode,
      startedBot: true,
      updatedAt: now,
    },
  }).run();

  let user = await db.select().from(users).where(eq(users.tgId, tgId)).get();
  if (!user) throw new Error('USER_UPSERT_FAILED');

  // Legacy preview users may not have a wallet ID yet. Assign one once using a
  // guarded NULL update so concurrent invocations cannot overwrite each other.
  if (!user.walletId) {
    let saved = false;
    for (let attempt = 0; attempt < 5 && !saved; attempt += 1) {
      const walletId = walletIdForUserId(tgId, walletSuffix());
      try {
        await db.update(users).set({ walletId, updatedAt: new Date() })
          .where(and(eq(users.tgId, tgId), isNull(users.walletId))).run();
      } catch (error) {
        const message = String(error?.message || error);
        if (!/unique|constraint|sqlite_constraint/i.test(message) || attempt === 4) throw error;
      }
      user = await db.select().from(users).where(eq(users.tgId, tgId)).get();
      if (user?.walletId) saved = true;
    }
    if (!saved) throw new Error('WALLET_ID_ASSIGNMENT_FAILED');
  }
  return user;
}

export async function getUser(tgId) {
  const numericId = Number(tgId);
  if (!Number.isSafeInteger(numericId) || numericId <= 0) return null;
  return db.select().from(users).where(eq(users.tgId, numericId)).get();
}

export async function listTopUsers(limit = 10) {
  const safeLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 10)));
  return db.select().from(users)
    .orderBy(desc(users.balance), asc(users.tgId))
    .limit(safeLimit)
    .all();
}

export function formatCoin(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount)) return '0';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(amount);
}

export function displayName(user) {
  if (user?.username) return '@' + user.username;
  const first = String(user?.firstName || '').trim();
  const last = String(user?.lastName || '').trim();
  const full = (first + ' ' + last).trim();
  return full || ('Player ' + String(user?.tgId || ''));
}
