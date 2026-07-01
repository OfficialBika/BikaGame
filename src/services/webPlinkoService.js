'use strict';

const { COIN } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getTreasury } = require('./treasuryService');
const { getWebGameRtp } = require('./webGameRtpService');
const { recordWebGameHistory } = require('./webBetHistoryService');

const MIN_BET = Math.max(1, Number(process.env.WEB_PLINKO_MIN_BET || 50));
const MAX_BET = Math.max(MIN_BET, Number(process.env.WEB_PLINKO_MAX_BET || 10000));
const CAP_PERCENT = Math.max(0.03, Math.min(0.40, Number(process.env.WEB_PLINKO_CAP_PERCENT || 0.12)));
const MAX_PAYOUT_MULTIPLIER = Math.max(1, Math.min(50, Number(process.env.WEB_PLINKO_MAX_PAYOUT_MULTIPLIER || 10)));

const BUCKETS = Object.freeze([
  Object.freeze({ index: 0, label: '0x', multiplier: 0, color: 'red' }),
  Object.freeze({ index: 1, label: '0.2x', multiplier: 0.2, color: 'red' }),
  Object.freeze({ index: 2, label: '0.5x', multiplier: 0.5, color: 'yellow' }),
  Object.freeze({ index: 3, label: '0.8x', multiplier: 0.8, color: 'yellow' }),
  Object.freeze({ index: 4, label: '1x', multiplier: 1, color: 'blue' }),
  Object.freeze({ index: 5, label: '1.5x', multiplier: 1.5, color: 'blue' }),
  Object.freeze({ index: 6, label: '2x', multiplier: 2, color: 'green' }),
  Object.freeze({ index: 7, label: '3x', multiplier: 3, color: 'green' }),
  Object.freeze({ index: 8, label: '5x', multiplier: 5, color: 'purple' }),
  Object.freeze({ index: 9, label: '10x', multiplier: 10, color: 'gold' }),
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

function buildWeightedBuckets(rtp) {
  const target = Math.max(40, Math.min(95, Number(rtp || 70))) / 100;
  const winBoost = 0.45 + target * 0.92;
  const lossBoost = 1.35 - target * 0.72;

  const base = [
    18, 18, 18, 15, 13, 8, 5, 3, 1.2, 0.35,
  ];

  return BUCKETS.map((bucket, index) => {
    let weight = base[index];
    if (bucket.multiplier < 1) weight *= lossBoost;
    else if (bucket.multiplier === 1) weight *= 0.95;
    else weight *= winBoost / Math.max(1, bucket.multiplier * 0.55);
    return { ...bucket, weight: Math.max(0.05, weight) };
  });
}

function generatePath(bucketIndex) {
  const rows = 12;
  const path = [];
  let pos = 5;
  for (let i = 0; i < rows; i += 1) {
    const wantRight = bucketIndex > pos;
    const randomRight = Math.random() > 0.5;
    const dir = Math.random() < 0.68 ? wantRight : randomRight;
    pos += dir ? 1 : -1;
    pos = Math.max(0, Math.min(9, pos));
    path.push(dir ? 'R' : 'L');
  }
  return path;
}

async function capPayout(bet, rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBet = Math.floor(Number(bet || 0) * MAX_PAYOUT_MULTIPLIER);
  const hardMax = Math.max(Number(bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
}

async function playWebPlinko({ userId, bet }) {
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

  const rtp = await getWebGameRtp('plinko');
  const bucket = weightedPick(buildWeightedBuckets(rtp));
  const rawPayout = Math.floor(amount * bucket.multiplier);

  await userPayToTreasury(userId, amount, {
    type: 'web_plinko_bet',
    source: 'miniapp_plinko',
    rtp,
    bucket: bucket.index,
  });

  let payout = 0;
  if (rawPayout > 0) {
    payout = await capPayout(amount, rawPayout);
    if (payout > 0) {
      await treasuryPayToUser(userId, payout, {
        type: 'web_plinko_win',
        source: 'miniapp_plinko',
        bet: amount,
        payout,
        rawPayout,
        multiplier: bucket.multiplier,
        rtp,
        bucket: bucket.index,
      });
    }
  }

  const updated = await getUser(userId);
  const path = generatePath(bucket.index);
  await recordWebGameHistory({
    userId,
    game: 'plinko',
    title: `Bucket ${bucket.label}`,
    outcome: payout > amount ? 'win' : payout > 0 ? 'paid' : 'lose',
    bet: amount,
    payout,
    net: payout - amount,
    multiplier: bucket.multiplier,
    label: bucket.label,
    meta: { bucket: bucket.index, rawPayout, rtp, path },
  });
  return {
    ok: true,
    game: 'plinko',
    coin: COIN,
    rtp,
    bet: amount,
    bucket: { index: bucket.index, label: bucket.label, multiplier: bucket.multiplier, color: bucket.color },
    path,
    payout,
    rawPayout,
    net: payout - amount,
    balance: Number(updated?.balance || 0),
  };
}

module.exports = {
  playWebPlinko,
  BUCKETS,
  MIN_BET,
  MAX_BET,
};
