import { db, EndpointError } from 'sdk';
import { and, eq } from 'sdk/db';
import { gameSessions } from '../schema.js';
import { ensureEconomy, ensureUser, userById, settleDuel } from './economy.js';

const MIN_BET = 10;
const MAX_BET = 99990000;
const CHALLENGE_TIMEOUT_MS = 60000;
const now = () => new Date();
const makeId = () => 'dice_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

function userIdOf(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new EndpointError('Invalid Telegram user ID.', { code: 'INVALID_USER' });
  return id;
}

function label(user) {
  const name = [user?.first_name ?? user?.firstName, user?.last_name ?? user?.lastName]
    .filter(Boolean).join(' ').trim();
  return (name || (user?.username ? '@' + user.username : 'Player')).slice(0, 80);
}

function expiresAtMs(value) {
  if (value instanceof Date) return value.getTime();
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return num < 100000000000 ? num * 1000 : num;
}

function isExpired(session) {
  return expiresAtMs(session?.expiresAt) <= Date.now();
}

function changedRows(result) {
  return Array.isArray(result?.rows) ? result.rows.length : Number(result?.rowsAffected || 0);
}

export async function createDiceChallenge({ challenger, target, chatId, bet }) {
  await ensureEconomy();
  const challengerId = userIdOf(challenger?.id);
  const targetId = userIdOf(target?.id);
  const groupId = Number(chatId);
  const amount = Number(bet);

  if (challengerId === targetId || target?.is_bot) {
    throw new EndpointError('Challenge a different human user.', { code: 'DICE_INVALID_TARGET' });
  }
  if (!Number.isSafeInteger(groupId) || groupId === 0) {
    throw new EndpointError('Dice Duel is only available in groups.', { code: 'DICE_GROUP_REQUIRED' });
  }
  if (!Number.isSafeInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    throw new EndpointError('Dice bet must be between 10 and 99,990,000 Bal.', { code: 'INVALID_BET' });
  }

  const challengerAccount = await ensureUser(challenger);
  await ensureUser(target);
  if (Number(challengerAccount?.balance || 0) < amount) {
    throw new EndpointError('Balance မလုံလောက်ပါ။', { code: 'USER_INSUFFICIENT' });
  }

  const open = await db.select().from(gameSessions)
    .where(and(eq(gameSessions.game, 'dice'), eq(gameSessions.status, 'waiting'))).all();
  const activeCount = open.filter((session) => !isExpired(session)).length;
  if (activeCount >= 5) throw new EndpointError('Dice challenge များနေပါတယ်။', { code: 'DICE_BUSY' });

  const id = makeId();
  const state = {
    challengerId,
    targetUserId: targetId,
    challengerName: label(challenger),
    targetName: label(target),
    challengerUsername: challenger?.username || null,
    targetUsername: target?.username || null,
    chatId: groupId,
    messageId: null,
    bet: amount,
    rollResult: null,
  };
  const timestamp = now();
  await db.insert(gameSessions).values({
    id,
    userId: challengerId,
    game: 'dice',
    status: 'creating',
    state,
    expiresAt: new Date(Date.now() + CHALLENGE_TIMEOUT_MS),
    createdAt: timestamp,
    updatedAt: timestamp,
  }).run();
  return { sessionId: id, bet: amount, expiresInMs: CHALLENGE_TIMEOUT_MS };
}

export async function activateDiceChallenge(sessionId, messageId) {
  const session = await getDiceChallenge(sessionId);
  if (!session || session.status !== 'creating') throw new EndpointError('Dice challenge could not be activated.', { code: 'DICE_NOT_READY' });
  const state = { ...session.state, messageId: Number(messageId) };
  await db.update(gameSessions)
    .set({ state, status: 'waiting', updatedAt: now() })
    .where(and(eq(gameSessions.id, session.id), eq(gameSessions.game, 'dice'), eq(gameSessions.status, 'creating')))
    .run();
  return getDiceChallenge(sessionId);
}

export async function failDiceChallengeCreation(sessionId) {
  await db.update(gameSessions)
    .set({ status: 'cancelled', updatedAt: now() })
    .where(and(eq(gameSessions.id, String(sessionId)), eq(gameSessions.game, 'dice'), eq(gameSessions.status, 'creating')))
    .run();
}

export async function getDiceChallenge(sessionId) {
  await ensureEconomy();
  const id = String(sessionId || '');
  if (!/^dice_[a-z0-9]+_[a-z0-9]+$/i.test(id)) return null;
  return db.select().from(gameSessions).where(and(eq(gameSessions.id, id), eq(gameSessions.game, 'dice'))).get();
}

export async function cancelDiceChallenge(sessionId, actorId) {
  const session = await getDiceChallenge(sessionId);
  if (!session) return { ok: false, missing: true };
  if (Number(actorId) !== Number(session.state?.challengerId)) {
    throw new EndpointError('Only the challenger can cancel this Dice Duel.', { code: 'DICE_CANCEL_OWNER_ONLY' });
  }
  if (session.status !== 'waiting') return { ok: false, status: session.status, session };
  if (isExpired(session)) {
    await db.update(gameSessions).set({ status: 'expired', updatedAt: now() })
      .where(and(eq(gameSessions.id, session.id), eq(gameSessions.status, 'waiting'))).run();
    return { ok: false, status: 'expired', session };
  }
  const ms = Math.floor(Date.now() / 1000);
  const result = await db.run(
    "UPDATE game_sessions SET status = 'cancelled', updated_at = :now WHERE id = :id AND game = 'dice' AND status = 'waiting' RETURNING id",
    { ':now': ms, ':id': session.id },
  );
  return { ok: changedRows(result) > 0, status: changedRows(result) > 0 ? 'cancelled' : (await getDiceChallenge(sessionId))?.status, session };
}

export async function claimDiceChallenge(sessionId, actorId) {
  const session = await getDiceChallenge(sessionId);
  if (!session) return { claimed: false, missing: true };
  if (Number(actorId) !== Number(session.state?.targetUserId)) {
    throw new EndpointError('ဒီ duel ကို reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်။', { code: 'DICE_TARGET_ONLY' });
  }
  if (session.status !== 'waiting') return { claimed: false, session };
  if (isExpired(session)) {
    await db.update(gameSessions).set({ status: 'expired', updatedAt: now() })
      .where(and(eq(gameSessions.id, session.id), eq(gameSessions.status, 'waiting'))).run();
    return { claimed: false, expired: true, session: { ...session, status: 'expired' } };
  }

  const ms = Math.floor(Date.now() / 1000);
  const result = await db.run(
    "UPDATE game_sessions SET status = 'rolling', updated_at = :now WHERE id = :id AND game = 'dice' AND status = 'waiting' AND expires_at > :now RETURNING id",
    { ':now': ms, ':id': session.id },
  );
  if (changedRows(result) > 0) return { claimed: true, session: { ...session, status: 'rolling' } };
  return { claimed: false, session: await getDiceChallenge(sessionId) };
}

export async function storeDiceRollResult(sessionId, rollResult) {
  const session = await getDiceChallenge(sessionId);
  if (!session || session.status !== 'rolling') throw new EndpointError('Dice challenge is no longer rolling.', { code: 'DICE_NOT_ROLLING' });
  if (session.state?.rollResult) return session.state.rollResult;
  const state = { ...session.state, rollResult };
  await db.update(gameSessions).set({ state, updatedAt: now() })
    .where(and(eq(gameSessions.id, session.id), eq(gameSessions.status, 'rolling'))).run();
  const updated = await getDiceChallenge(sessionId);
  if (!updated?.state?.rollResult) throw new EndpointError('Dice result could not be saved safely.', { code: 'DICE_RESULT_NOT_SAVED' });
  return updated.state.rollResult;
}

export async function settleDiceChallenge(sessionId) {
  const session = await getDiceChallenge(sessionId);
  if (!session) throw new EndpointError('Dice challenge not found.', { code: 'DICE_CHALLENGE_NOT_FOUND' });
  if (session.status === 'settled') return { ok: true, duplicate: true, session };
  const state = session.state || {};
  const result = state.rollResult;
  if (session.status !== 'rolling' || !result || ![result.d1, result.d2].every((value) => Number.isInteger(value) && value >= 1 && value <= 6)) {
    throw new EndpointError('Dice result is not ready for settlement.', { code: 'DICE_RESULT_NOT_READY' });
  }

  const winnerUserId = result.winner === 'A' ? state.challengerId : result.winner === 'B' ? state.targetUserId : null;
  const payout = Math.floor(Number(state.bet) * 2 * 0.98);
  const settlement = await settleDuel({
    settlementId: session.id,
    typePrefix: 'dice',
    challengerId: state.challengerId,
    targetUserId: state.targetUserId,
    winnerUserId,
    bet: Number(state.bet),
    payout,
    meta: { chatId: state.chatId, d1: result.d1, d2: result.d2, result: { d1: result.d1, d2: result.d2, winner: result.winner } },
  });
  const nextState = { ...state, settlement: { duplicate: settlement.duplicate, winnerUserId, payout, result } };
  await db.update(gameSessions).set({ state: nextState, status: 'settled', updatedAt: now() })
    .where(and(eq(gameSessions.id, session.id), eq(gameSessions.status, 'rolling'))).run();
  return { ok: true, duplicate: settlement.duplicate, session: { ...session, state: nextState, status: 'settled' }, settlement };
}

export async function failDiceChallenge(sessionId) {
  const session = await getDiceChallenge(sessionId);
  if (!session || session.status !== 'rolling' || session.state?.rollResult) return false;
  await db.update(gameSessions).set({ status: 'failed', updatedAt: now() })
    .where(and(eq(gameSessions.id, session.id), eq(gameSessions.status, 'rolling'))).run();
  return true;
}
