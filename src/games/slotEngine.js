'use strict';

const { chance } = require('../services/vipService');

const SYMBOLS = Object.freeze([
  Object.freeze({ s: '🍒', w: 3200 }),
  Object.freeze({ s: '🍋', w: 2200 }),
  Object.freeze({ s: '🍉', w: 1500 }),
  Object.freeze({ s: '🔔', w: 900 }),
  Object.freeze({ s: '⭐', w: 450 }),
  Object.freeze({ s: 'BAR', w: 200 }),
  Object.freeze({ s: '7', w: 100 }),
]);

const SLOT_DATA = Object.freeze({
  reels: Object.freeze([
    Object.freeze([...SYMBOLS]),
    Object.freeze([...SYMBOLS]),
    Object.freeze([...SYMBOLS]),
  ]),
  payouts: Object.freeze({
    '7,7,7': 20,
    'BAR,BAR,BAR': 15,
    '⭐,⭐,⭐': 12,
    '🔔,🔔,🔔': 9,
    '🍉,🍉,🍉': 7,
    '🍋,🍋,🍋': 5,
    '🍒,🍒,🍒': 3,
    ANY2: 1.5,
  }),
});

/**
 * Higher weight = easier.
 * Lower weight = harder.
 *
 * 777 is intentionally very hard.
 * 777 weight is set to 6 as requested.
 */
const WIN_COMBO_WEIGHTS = Object.freeze([
  Object.freeze({ reels: ['🍒', '🍒', '🍒'], w: 5200 }),
  Object.freeze({ reels: ['🍋', '🍋', '🍋'], w: 2800 }),
  Object.freeze({ reels: ['🍉', '🍉', '🍉'], w: 1200 }),
  Object.freeze({ reels: ['🔔', '🔔', '🔔'], w: 420 }),
  Object.freeze({ reels: ['⭐', '⭐', '⭐'], w: 120 }),
  Object.freeze({ reels: ['BAR', 'BAR', 'BAR'], w: 35 }),
  Object.freeze({ reels: ['7', '7', '7'], w: 6 }),
]);

let losingCache = null;

function percent(value, fallback = 35) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function safeChance(rate) {
  try {
    const result = Number(chance(percent(rate, 90)));
    if (Number.isFinite(result)) return Math.max(0, Math.min(1, result));
  } catch (_) {}

  return percent(rate, 90) / 100;
}

function weightedPick(items, random = Math.random) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('weightedPick expects non-empty array');
  }

  const total = items.reduce((sum, item) => sum + Number(item.w || 0), 0);

  if (!Number.isFinite(total) || total <= 0) {
    throw new TypeError('weightedPick total weight must be positive');
  }

  let cursor = Math.max(0, Math.min(0.999999999999, Number(random()))) * total;

  for (const item of items) {
    cursor -= Number(item.w || 0);
    if (cursor < 0) return item;
  }

  return items[items.length - 1];
}

function normalSpin(random = Math.random) {
  return SLOT_DATA.reels.map((reel) => weightedPick(reel, random).s);
}

function isAnyTwo(a, b, c) {
  return (
    (a === b && a !== c) ||
    (a === c && a !== b) ||
    (b === c && b !== a)
  );
}

function validateReels(reels) {
  if (!Array.isArray(reels) || reels.length !== 3) {
    throw new TypeError('Slot result must contain exactly 3 reels');
  }

  for (const symbol of reels) {
    if (typeof symbol !== 'string' || symbol.length === 0) {
      throw new TypeError('Slot result contains invalid symbol');
    }
  }
}

function multiplier(reels) {
  validateReels(reels);

  const key = reels.join(',');

  if (Object.prototype.hasOwnProperty.call(SLOT_DATA.payouts, key)) {
    return Number(SLOT_DATA.payouts[key]) || 0;
  }

  return isAnyTwo(reels[0], reels[1], reels[2])
    ? Number(SLOT_DATA.payouts.ANY2) || 0
    : 0;
}

function getLosingCombinations() {
  const symbols = SLOT_DATA.reels[0].map((item) => item.s);
  const losing = [];

  for (const a of symbols) {
    for (const b of symbols) {
      for (const c of symbols) {
        const reels = [a, b, c];

        if (multiplier(reels) === 0) {
          losing.push(Object.freeze({ reels, w: 1 }));
        }
      }
    }
  }

  return losing;
}

function losingSpin(random = Math.random) {
  if (!losingCache) losingCache = getLosingCombinations();
  return [...weightedPick(losingCache, random).reels];
}

function weightedWinSpin(random = Math.random) {
  return [...weightedPick(WIN_COMBO_WEIGHTS, random).reels];
}

function vipSpin(rate = 90, random = Math.random) {
  if (Number(random()) < safeChance(rate)) {
    return weightedWinSpin(random);
  }

  return normalSpin(random);
}

/**
 * Owner-controlled RTP win-rate spin.
 * RTP controls win/lose frequency only.
 * Jackpot rarity is controlled by WIN_COMBO_WEIGHTS.
 */
function controlledSpin(user, options = {}, random = Math.random) {
  const vipWinRate = percent(options.vipWinRate, 90);
  const rtpWinRate = percent(options.rtpWinRate, 35);
  const winRate = user?.isVip ? Math.max(vipWinRate, rtpWinRate) : rtpWinRate;

  return Number(random()) < winRate / 100
    ? weightedWinSpin(random)
    : losingSpin(random);
}

/**
 * Backward compatible:
 * old: spin(user, vipWinRate)
 * new: spin(user, vipWinRate, Math.random, rtpWinRate)
 */
function spin(user, vipWinRate = 90, random = Math.random, rtpWinRate = null) {
  if (rtpWinRate != null) {
    return controlledSpin(user, { vipWinRate, rtpWinRate }, random);
  }

  return user?.isVip ? vipSpin(vipWinRate, random) : normalSpin(random);
}

function calculatePayout(bet, reels) {
  const amount = Math.floor(Number(bet));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TypeError('Bet must be a positive number');
  }

  return Math.floor(amount * multiplier(reels));
}

function art(reels) {
  validateReels(reels);

  const display = reels.map((symbol) => (symbol === '7' ? '7️⃣' : symbol));

  return [
    '┏━━━━━━━━━━━━━━━━━━┓',
    `┃  ${display[0]}  |  ${display[1]}  |  ${display[2]}  ┃`,
    '┗━━━━━━━━━━━━━━━━━━┛',
  ].join('\n');
}

function baseRtp() {
  return 0;
}

module.exports = {
  SLOT_DATA,
  WIN_COMBO_WEIGHTS,
  weightedPick,
  normalSpin,
  vipSpin,
  controlledSpin,
  spin,
  isAnyTwo,
  multiplier,
  calculatePayout,
  art,
  baseRtp,
};
