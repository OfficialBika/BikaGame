'use strict';

const { COIN, CRASH = {} } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getTreasury } = require('./treasuryService');

const sessions = new Map();
const endedSessions = new Map();

const MIN_BET = Math.max(1, Number(CRASH.minBet || process.env.CRASH_MIN_BET || 50));
const MAX_BET = Math.max(MIN_BET, Number(CRASH.maxBet || process.env.CRASH_MAX_BET || 10000));
const HOUSE_EDGE = Math.max(0.05, Math.min(0.50, Number(CRASH.houseEdge ?? process.env.CRASH_HOUSE_EDGE ?? 0.24)));
const CAP_PERCENT = Math.max(0.03, Math.min(0.50, Number(CRASH.capPercent ?? process.env.CRASH_CAP_PERCENT ?? 0.12)));
const CRASH_MAX_MULTIPLIER = Math.max(1.2, Math.min(20, Number(CRASH.maxMultiplier || process.env.CRASH_MAX_MULTIPLIER || 6)));
const PAYOUT_MAX_MULTIPLIER = Math.max(1, Math.min(CRASH_MAX_MULTIPLIER, Number(CRASH.maxPayoutMultiplier || process.env.CRASH_MAX_PAYOUT_MULTIPLIER || 4)));
const INSTANT_CRASH_PERCENT = Math.max(0, Math.min(40, Number(CRASH.instantCrashPercent || process.env.CRASH_INSTANT_PERCENT || 10)));
const MIN_VISIBLE_MULTIPLIER = Math.max(1.05, Math.min(CRASH_MAX_MULTIPLIER, Number(CRASH.minVisibleMultiplier || process.env.CRASH_MIN_VISIBLE_MULTIPLIER || 1.16)));
const LOW_CRASH_MAX_MULTIPLIER = Math.max(MIN_VISIBLE_MULTIPLIER, Math.min(CRASH_MAX_MULTIPLIER, Number(CRASH.lowCrashMaxMultiplier || process.env.CRASH_LOW_CRASH_MAX_MULTIPLIER || 1.35)));
const MIN_CASHOUT_MULTIPLIER = Math.max(1, Math.min(PAYOUT_MAX_MULTIPLIER, Number(CRASH.minCashoutMultiplier || process.env.CRASH_MIN_CASHOUT_MULTIPLIER || 1.10)));
const ENDED_TTL_MS = Math.max(5000, Number(process.env.WEB_CRASH_ENDED_TTL_MS || 30000));

function cleanUserId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

function parseBet(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function round2(value) {
  return Math.max(1, Math.floor(Number(value || 1) * 100) / 100);
}

function makeId() {
  return `wcr${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function generateCrashPoint() {
  if (Math.random() * 100 < INSTANT_CRASH_PERCENT) {
    return round2(MIN_VISIBLE_MULTIPLIER + Math.random() * (LOW_CRASH_MAX_MULTIPLIER - MIN_VISIBLE_MULTIPLIER));
  }

  const r = Math.max(0.0001, Math.min(0.9999, Math.random()));
  let point = (1 - HOUSE_EDGE) / (1 - r);
  point *= 0.66 + Math.random() * 0.20;
  point = Math.min(point, CRASH_MAX_MULTIPLIER);
  point = Math.max(point, MIN_VISIBLE_MULTIPLIER);
  return round2(point);
}

function currentMultiplier(session) {
  if (!session || session.state !== 'running') return round2(session?.finalMultiplier || session?.currentMultiplier || 1);

  const elapsedSec = Math.max(0, (Date.now() - session.startedAtMs) / 1000);
  const grown = 1 + elapsedSec * 0.20 + Math.pow(elapsedSec, 1.45) * 0.055;
  return round2(Math.min(grown, session.crashPoint));
}

function publicSession(session, extra = {}) {
  if (!session) return { active: false, coin: COIN };
  const multiplier = currentMultiplier(session);
  return {
    active: session.state === 'running',
    id: session.id,
    state: session.state,
    coin: COIN,
    bet: session.bet,
    multiplier,
    cashoutMinMultiplier: MIN_CASHOUT_MULTIPLIER,
    maxPayoutMultiplier: PAYOUT_MAX_MULTIPLIER,
    crashed: session.state === 'crashed',
    cashedOut: session.state === 'cashed_out',
    payout: session.payout || 0,
    net: Number(session.payout || 0) - Number(session.bet || 0),
    crashPoint: session.state === 'running' ? null : session.crashPoint,
    startedAt: session.startedAt,
    ...extra,
  };
}

function archiveEnded(userId, session) {
  session.endedAtMs = Date.now();
  endedSessions.set(userId, session);
  sessions.delete(userId);
}

function cleanupEnded() {
  const now = Date.now();
  for (const [userId, session] of endedSessions.entries()) {
    if (now - Number(session.endedAtMs || 0) > ENDED_TTL_MS) {
      endedSessions.delete(userId);
    }
  }
}

function settleIfCrashed(userId, session) {
  if (!session || session.state !== 'running') return session;
  const multiplier = currentMultiplier(session);

  if (multiplier >= session.crashPoint) {
    session.state = 'crashed';
    session.finalMultiplier = session.crashPoint;
    session.payout = 0;
    archiveEnded(userId, session);
    return session;
  }

  session.currentMultiplier = multiplier;
  return session;
}

async function capCrashPayout(session, rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBet = Math.floor(Number(session.bet || 0) * PAYOUT_MAX_MULTIPLIER);
  const hardMax = Math.max(Number(session.bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
}

async function startWebCrash({ userId, bet }) {
  cleanupEnded();
  const finalUserId = cleanUserId(userId);
  const amount = parseBet(bet);

  if (!finalUserId) throw new Error('INVALID_USER');
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    const err = new Error('BET_RANGE');
    err.minBet = MIN_BET;
    err.maxBet = MAX_BET;
    throw err;
  }

  const existing = sessions.get(finalUserId);
  if (existing) {
    const settled = settleIfCrashed(finalUserId, existing);
    if (settled?.state === 'running') throw new Error('CRASH_RUNNING');
  }

  const user = await getUser(finalUserId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (Number(user.balance || 0) < amount) throw new Error('USER_INSUFFICIENT');

  await userPayToTreasury(finalUserId, amount, {
    type: 'web_crash_bet',
    source: 'miniapp',
  });

  const session = {
    id: makeId(),
    userId: finalUserId,
    bet: amount,
    crashPoint: generateCrashPoint(),
    currentMultiplier: 1,
    state: 'running',
    payout: 0,
    startedAtMs: Date.now(),
    startedAt: new Date().toISOString(),
    cashingOut: false,
  };

  sessions.set(finalUserId, session);
  endedSessions.delete(finalUserId);

  const updated = await getUser(finalUserId);
  return publicSession(session, { balance: Number(updated?.balance || 0) });
}

async function getWebCrashStatus(userId) {
  cleanupEnded();
  const finalUserId = cleanUserId(userId);
  if (!finalUserId) throw new Error('INVALID_USER');

  const active = sessions.get(finalUserId);
  if (active) {
    return publicSession(settleIfCrashed(finalUserId, active));
  }

  const ended = endedSessions.get(finalUserId);
  return publicSession(ended || null);
}

async function cashoutWebCrash({ userId }) {
  const finalUserId = cleanUserId(userId);
  if (!finalUserId) throw new Error('INVALID_USER');

  const session = sessions.get(finalUserId);
  if (!session) throw new Error('NO_ACTIVE_CRASH');
  if (session.cashingOut) throw new Error('CASHOUT_PROCESSING');

  const multiplier = currentMultiplier(session);
  if (multiplier >= session.crashPoint) {
    session.state = 'crashed';
    session.finalMultiplier = session.crashPoint;
    archiveEnded(finalUserId, session);
    throw new Error('CRASHED');
  }

  if (multiplier < MIN_CASHOUT_MULTIPLIER) {
    const err = new Error('CASHOUT_LOCKED');
    err.minMultiplier = MIN_CASHOUT_MULTIPLIER;
    throw err;
  }

  session.cashingOut = true;

  try {
    const effectiveMultiplier = Math.min(multiplier, PAYOUT_MAX_MULTIPLIER);
    const rawPayout = Math.floor(session.bet * effectiveMultiplier);
    const payout = await capCrashPayout(session, rawPayout);

    await treasuryPayToUser(finalUserId, payout, {
      type: 'web_crash_win',
      source: 'miniapp',
      bet: session.bet,
      payout,
      rawPayout,
      multiplier: effectiveMultiplier,
      shownMultiplier: multiplier,
    });

    session.state = 'cashed_out';
    session.finalMultiplier = multiplier;
    session.cashoutMultiplier = effectiveMultiplier;
    session.payout = payout;
    archiveEnded(finalUserId, session);

    const updated = await getUser(finalUserId);
    return publicSession(session, {
      multiplier,
      effectiveMultiplier,
      rawPayout,
      payout,
      balance: Number(updated?.balance || 0),
    });
  } finally {
    session.cashingOut = false;
  }
}

module.exports = {
  startWebCrash,
  getWebCrashStatus,
  cashoutWebCrash,
  _private: {
    generateCrashPoint,
    currentMultiplier,
    round2,
  },
};
