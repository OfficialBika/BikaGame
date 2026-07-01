'use strict';

const { COIN } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getTreasury } = require('./treasuryService');
const { getWebGameRtp } = require('./webGameRtpService');
const { recordWebGameHistory } = require('./webBetHistoryService');

const MIN_BET = Math.max(1, Number(process.env.WEB_WHEEL_MIN_BET || 50));
const MAX_BET = Math.max(MIN_BET, Number(process.env.WEB_WHEEL_MAX_BET || 10000));
const CAP_PERCENT = Math.max(0.03, Math.min(0.40, Number(process.env.WEB_WHEEL_CAP_PERCENT || 0.12)));
const MAX_PAYOUT_MULTIPLIER = Math.max(1, Math.min(50, Number(process.env.WEB_WHEEL_MAX_PAYOUT_MULTIPLIER || 8)));

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

async function capPayout(bet, rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBet = Math.floor(Number(bet || 0) * MAX_PAYOUT_MULTIPLIER);
  const hardMax = Math.max(Number(bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
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
    meta: { segment: segment.index, rawPayout, rtp },
  });
  return {
    ok: true,
    game: 'wheel',
    coin: COIN,
    rtp,
    bet: amount,
    segment: { index: segment.index, label: segment.label, multiplier: segment.multiplier, color: segment.color },
    spinAngle: 360 * 5 + (360 - (segment.index * 36 + 18)),
    payout,
    rawPayout,
    net: payout - amount,
    balance: Number(updated?.balance || 0),
  };
}

module.exports = {
  spinWebWheel,
  SEGMENTS,
  MIN_BET,
  MAX_BET,
};
