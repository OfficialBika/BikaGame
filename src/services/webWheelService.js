'use strict';

const { COIN } = require('../config/constants');
const { getDb } = require('../config/database');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getTreasury } = require('./treasuryService');
const { getWebGameRtp } = require('./webGameRtpService');
const { recordWebGameHistory } = require('./webBetHistoryService');

const MIN_BET = Math.max(1, Number(process.env.WEB_WHEEL_MIN_BET || 50));
const MAX_BET = Math.max(MIN_BET, Number(process.env.WEB_WHEEL_MAX_BET || 10000));
const CAP_PERCENT = Math.max(0.03, Math.min(0.40, Number(process.env.WEB_WHEEL_CAP_PERCENT || 0.12)));
const MAX_PAYOUT_MULTIPLIER = Math.max(1, Math.min(50, Number(process.env.WEB_WHEEL_MAX_PAYOUT_MULTIPLIER || 8)));
const DAILY_BASE_REWARD = Math.max(10, Number(process.env.WEB_WHEEL_DAILY_BASE_REWARD || 500));
const DAILY_TZ_OFFSET_MINUTES = Number(process.env.WEB_WHEEL_DAILY_TZ_OFFSET_MINUTES || 0);

const SEGMENT_DEGREES = 36;

const SEGMENTS = Object.freeze([
  Object.freeze({ index: 0, label: '0x', multiplier: 0, color: '#ef4444' }),
  Object.freeze({ index: 1, label: '0.2x', multiplier: 0.2, color: '#fb7185' }),
  Object.freeze({ index: 2, label: '0.5x', multiplier: 0.5, color: '#f59e0b' }),
  Object.freeze({ index: 3, label: '1x', multiplier: 1, color: '#22d3ee' }),
  Object.freeze({ index: 4, label: '1.5x', multiplier: 1.5, color: '#3b82f6' }),
  Object.freeze({ index: 5, label: '2x', multiplier: 2, color: '#22c55e' }),
  Object.freeze({ index: 6, label: '3x', multiplier: 3, color: '#a855f7' }),
  Object.freeze({ index: 7, label: '5x', multiplier: 5, color: '#eab308' }),
  Object.freeze({ index: 8, label: '8x', multiplier: 8, color: '#f97316' }),
  Object.freeze({ index: 9, label: 'JACK', multiplier: 12, color: '#f43f5e' }),
]);

let dailyIndexPromise = null;

function parseBet(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight || 0)), 0);
  let cursor = Math.random() * Math.max(1, total);
  for (const item of items) {
    cursor -= Math.max(0, Number(item.weight || 0));
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function buildWeightedSegments(rtp) {
  const target = Math.max(40, Math.min(95, Number(rtp || 70))) / 100;
  const highBoost = 0.35 + target * 0.88;
  const lossBoost = 1.42 - target * 0.74;
  const base = [22, 16, 16, 14, 10, 7, 4.2, 1.8, 0.8, 0.22];

  return SEGMENTS.map((segment, index) => {
    let weight = base[index];
    if (segment.multiplier < 1) weight *= lossBoost;
    else if (segment.multiplier === 1) weight *= 1.0;
    else weight *= highBoost / Math.max(1, segment.multiplier * 0.6);
    return { ...segment, weight: Math.max(0.03, weight) };
  });
}

function stopAngleForSegment(index, jitter = 0) {
  const center = Number(index || 0) * SEGMENT_DEGREES + SEGMENT_DEGREES / 2;
  return ((360 - center + Number(jitter || 0)) % 360 + 360) % 360;
}

function randomSafeJitter() {
  return (Math.random() * 12) - 6;
}

async function capPayout(bet, rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBet = Math.floor(Number(bet || 0) * MAX_PAYOUT_MULTIPLIER);
  const hardMax = Math.max(Number(bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
}

async function capDailyPayout(rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBase = Math.floor(DAILY_BASE_REWARD * MAX_PAYOUT_MULTIPLIER);
  const hardMax = Math.max(0, Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBase));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
}

function dailyCollection() {
  return getDb().collection('web_wheel_daily_claims');
}

function shiftedNow(now = new Date()) {
  return new Date(now.getTime() + DAILY_TZ_OFFSET_MINUTES * 60 * 1000);
}

function dailyDateKey(now = new Date()) {
  return shiftedNow(now).toISOString().slice(0, 10);
}

function nextDailyResetMs(now = new Date()) {
  const shifted = shiftedNow(now);
  const next = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1, 0, 0, 0, 0));
  return next.getTime() - DAILY_TZ_OFFSET_MINUTES * 60 * 1000;
}

async function ensureDailyIndexes() {
  if (!dailyIndexPromise) {
    dailyIndexPromise = Promise.all([
      dailyCollection().createIndex({ userId: 1, dateKey: 1 }, { unique: true, name: 'userId_1_dateKey_1' }).catch(() => null),
      dailyCollection().createIndex({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 8, name: 'ttl_createdAt_8d' }).catch(() => null),
    ]);
  }
  return dailyIndexPromise;
}

async function getDailyWheelStatus(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) throw new Error('INVALID_USER');
  await ensureDailyIndexes();
  const dateKey = dailyDateKey();
  const existing = await dailyCollection().findOne({ userId: Math.floor(uid), dateKey });
  return {
    ok: true,
    available: !existing,
    dateKey,
    baseReward: DAILY_BASE_REWARD,
    nextAtMs: nextDailyResetMs(),
    last: existing ? {
      label: existing.label,
      multiplier: Number(existing.multiplier || 0),
      payout: Number(existing.payout || 0),
      claimedAtMs: Number(existing.claimedAtMs || existing.createdAt?.getTime?.() || 0),
    } : null,
  };
}

async function spinWebWheel({ userId, bet }) {
  const amount = parseBet(bet);
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    const err = new Error('BET_RANGE');
    err.minBet = MIN_BET;
    err.maxBet = MAX_BET;
    throw err;
  }

  const user = await getUser(userId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (Number(user.balance || 0) < amount) throw new Error('USER_INSUFFICIENT');

  const rtp = await getWebGameRtp('wheel');
  const segment = weightedPick(buildWeightedSegments(rtp));
  const rawPayout = Math.floor(amount * segment.multiplier);

  await userPayToTreasury(userId, amount, {
    type: 'web_wheel_bet',
    source: 'miniapp_wheel',
    rtp,
    segment: segment.index,
  });

  let payout = 0;
  if (rawPayout > 0) {
    payout = await capPayout(amount, rawPayout);
    if (payout > 0) {
      await treasuryPayToUser(userId, payout, {
        type: 'web_wheel_win',
        source: 'miniapp_wheel',
        bet: amount,
        payout,
        rawPayout,
        multiplier: segment.multiplier,
        rtp,
        segment: segment.index,
      });
    }
  }

  const updated = await getUser(userId);
  await recordWebGameHistory({
    userId,
    game: 'wheel',
    title: `Wheel ${segment.label}`,
    outcome: payout > amount ? 'win' : payout > 0 ? 'paid' : 'lose',
    bet: amount,
    payout,
    net: payout - amount,
    multiplier: segment.multiplier,
    label: segment.label,
    meta: { segment: segment.index, rawPayout, rtp, mode: 'paid' },
  });

  const jitter = randomSafeJitter();
  return {
    ok: true,
    mode: 'paid',
    game: 'wheel',
    coin: COIN,
    rtp,
    bet: amount,
    segment: { index: segment.index, label: segment.label, multiplier: segment.multiplier, color: segment.color },
    stopAngleDegrees: stopAngleForSegment(segment.index, jitter),
    stopAngleJitter: jitter,
    payout,
    rawPayout,
    net: payout - amount,
    balance: Number(updated?.balance || 0),
  };
}

async function spinDailyWebWheel({ userId }) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) throw new Error('INVALID_USER');
  const user = await getUser(uid);
  if (!user) throw new Error('USER_NOT_FOUND');

  await ensureDailyIndexes();
  const dateKey = dailyDateKey();
  const now = new Date();
  const existing = await dailyCollection().findOne({ userId: Math.floor(uid), dateKey });
  if (existing) {
    const err = new Error('WHEEL_DAILY_USED');
    err.nextAtMs = nextDailyResetMs(now);
    throw err;
  }

  const rtp = await getWebGameRtp('wheel');
  const segment = weightedPick(buildWeightedSegments(rtp));
  const rawPayout = Math.floor(DAILY_BASE_REWARD * segment.multiplier);
  let payout = 0;
  if (rawPayout > 0) payout = await capDailyPayout(rawPayout);

  const claim = {
    userId: Math.floor(uid),
    dateKey,
    label: segment.label,
    multiplier: segment.multiplier,
    segment: segment.index,
    baseReward: DAILY_BASE_REWARD,
    rawPayout,
    payout,
    claimedAtMs: now.getTime(),
    createdAt: now,
  };

  try {
    await dailyCollection().insertOne(claim);
  } catch (err) {
    if (err?.code === 11000) {
      const used = new Error('WHEEL_DAILY_USED');
      used.nextAtMs = nextDailyResetMs(now);
      throw used;
    }
    throw err;
  }

  if (payout > 0) {
    await treasuryPayToUser(uid, payout, {
      type: 'web_wheel_daily_win',
      source: 'miniapp_wheel_daily',
      baseReward: DAILY_BASE_REWARD,
      payout,
      rawPayout,
      multiplier: segment.multiplier,
      rtp,
      segment: segment.index,
      dateKey,
    });
  }

  const updated = await getUser(uid);
  await recordWebGameHistory({
    userId: uid,
    game: 'wheel',
    title: `Daily Wheel ${segment.label}`,
    outcome: payout > 0 ? 'daily_win' : 'daily_lose',
    bet: 0,
    payout,
    net: payout,
    multiplier: segment.multiplier,
    label: segment.label,
    meta: { segment: segment.index, rawPayout, rtp, mode: 'daily', baseReward: DAILY_BASE_REWARD, dateKey },
  });

  const jitter = randomSafeJitter();
  return {
    ok: true,
    mode: 'daily',
    game: 'wheel',
    coin: COIN,
    rtp,
    bet: 0,
    baseReward: DAILY_BASE_REWARD,
    segment: { index: segment.index, label: segment.label, multiplier: segment.multiplier, color: segment.color },
    stopAngleDegrees: stopAngleForSegment(segment.index, jitter),
    stopAngleJitter: jitter,
    payout,
    rawPayout,
    net: payout,
    balance: Number(updated?.balance || 0),
    daily: await getDailyWheelStatus(uid),
  };
}

module.exports = {
  spinWebWheel,
  spinDailyWebWheel,
  getDailyWheelStatus,
  SEGMENTS,
  MIN_BET,
  MAX_BET,
  DAILY_BASE_REWARD,
  stopAngleForSegment,
};
