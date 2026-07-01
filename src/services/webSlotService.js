'use strict';

const { COIN, SLOT } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getTreasury } = require('./treasuryService');
const engine = require('../games/slotEngine');
const { recordWebGameHistory } = require('./webBetHistoryService');

const activeSpins = new Set();
const cooldowns = new Map();

function cleanUserId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

function parseBet(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function clampRtp(value, fallback = 35) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(0, Math.min(100, Number(fallback) || 35));
  return Math.max(0, Math.min(100, numeric));
}

function checkCooldown(userId) {
  const waitMs = Math.max(0, Number(SLOT.cooldownMs || 700));
  const now = Date.now();
  const until = cooldowns.get(userId) || 0;

  if (until > now) {
    return Math.ceil((until - now) / 1000);
  }

  cooldowns.set(userId, now + waitMs);
  return 0;
}

async function capSlotPayout(bet, payout) {
  if (payout <= 0) return 0;
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const capPercent = Math.max(0, Math.min(1, Number(SLOT.capPercent || 0.30)));
  const maxPayout = Math.floor(ownerBalance * capPercent);
  return Math.max(0, Math.min(Math.floor(payout), maxPayout, ownerBalance));
}

async function spinWebSlot({ userId, bet }) {
  const finalUserId = cleanUserId(userId);
  const amount = parseBet(bet);

  if (!finalUserId) throw new Error('INVALID_USER');
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('INVALID_BET');
  if (amount < Number(SLOT.minBet || 50) || amount > Number(SLOT.maxBet || 7000)) {
    const err = new Error('BET_RANGE');
    err.minBet = Number(SLOT.minBet || 50);
    err.maxBet = Number(SLOT.maxBet || 7000);
    throw err;
  }

  const cooldownLeft = checkCooldown(finalUserId);
  if (cooldownLeft > 0) {
    const err = new Error('COOLDOWN');
    err.cooldownLeft = cooldownLeft;
    throw err;
  }

  if (activeSpins.has(finalUserId)) throw new Error('SPIN_RUNNING');
  activeSpins.add(finalUserId);

  let betTaken = false;

  try {
    const user = await getUser(finalUserId);
    if (!user) throw new Error('USER_NOT_FOUND');
    if (Number(user.balance || 0) < amount) throw new Error('USER_INSUFFICIENT');

    await userPayToTreasury(finalUserId, amount, {
      type: 'web_slot_bet',
      source: 'miniapp',
    });
    betTaken = true;

    const treasury = await getTreasury();
    const rtpWinRate = clampRtp(treasury?.rtpWinRate, 35);
    const vipWinRate = clampRtp(treasury?.vipWinRate, 90);

    const reels = engine.spin(user, vipWinRate, Math.random, rtpWinRate);
    const multiplier = Number(engine.multiplier(reels)) || 0;
    const rawPayout = multiplier > 0 ? Math.floor(amount * multiplier) : 0;
    const payout = await capSlotPayout(amount, rawPayout);

    if (payout > 0) {
      try {
        await treasuryPayToUser(finalUserId, payout, {
          type: 'web_slot_win',
          source: 'miniapp',
          bet: amount,
          payout,
          rawPayout,
          multiplier,
          combo: reels.join(','),
          rtpWinRate,
        });
      } catch (err) {
        try {
          await treasuryPayToUser(finalUserId, amount, {
            type: 'web_slot_refund',
            source: 'miniapp',
            bet: amount,
            reason: 'web_slot_payout_failed',
          });
        } catch (_) {}
        betTaken = false;
        throw err;
      }
    }

    betTaken = false;
    const updated = await getUser(finalUserId);
    await recordWebGameHistory({
      userId: finalUserId,
      game: 'slot',
      title: reels.join(' '),
      outcome: payout > amount ? 'win' : payout > 0 ? 'paid' : 'lose',
      bet: amount,
      payout,
      net: payout - amount,
      multiplier,
      label: reels.join(' '),
      meta: { reels, rawPayout, rtpWinRate, vip: !!user.isVip },
    });

    return {
      ok: true,
      coin: COIN,
      bet: amount,
      reels,
      art: engine.art(reels),
      multiplier,
      rawPayout,
      payout,
      net: payout - amount,
      balance: Number(updated?.balance || 0),
      result: payout > 0 ? 'WIN' : 'LOSE',
    };
  } catch (err) {
    if (betTaken) {
      try {
        await treasuryPayToUser(finalUserId, amount, {
          type: 'web_slot_refund',
          source: 'miniapp',
          bet: amount,
          reason: 'web_slot_runtime_error',
        });
      } catch (_) {}
    }

    throw err;
  } finally {
    activeSpins.delete(finalUserId);
  }
}

module.exports = {
  spinWebSlot,
};
