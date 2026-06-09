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

    // Two-match win payout.
    // Example: 🍒 🍒 🍋 = bet x 1.5
    ANY2: 1.5,
  }),
});

/**
 * Three-match win weights.
 * Higher weight = easier.
 * Lower weight = harder.
 *
 * 777 weight is set to 6.
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

/**
 * Two-match win weights.
 * Higher symbols are still rare.
 */
const TWO_MATCH_SYMBOL_WEIGHTS = Object.freeze([
  Object.freeze({ s: '🍒', w: 5200 }),
  Object.freeze({ s: '🍋', w: 2800 }),
  Object.freeze({ s: '🍉', w: 1200 }),
  Object.freeze({ s: '🔔', w: 420 }),
  Object.freeze({ s: '⭐', w: 120 }),
  Object.freeze({ s: 'BAR', w: 35 }),
  Object.freeze({ s: '7', w: 6 }),
]);

// Inside the win part, 85% will be two-match win and 15% will be three-match win.
// /setrtp still controls only win vs lose.
// Example: /setrtp 35 => 35% win, and inside that win: 85% two-match.
const TWO_MATCH_IN_WIN_RATE = 85;

let losingCache = null;

function percent(value, fallback = 35) {
  const n = Number(value);

  if (!Number.isFinite(n)) return fallback;

  return Math.max(0, Math.min(100, n));
}

function safeChance(rate) {
  try {
    const result = Number(chance(percent(rate, 90)));

    if (Number.isFinite(result)) {
      return Math.max(0, Math.min(1, result));
    }
  } catch (_) {}

  return percent(rate, 90) / 100;
}

function randomIndex(length, random = Math.random) {
  return Math.floor(
    Math.max(0, Math.min(0.999999999999, Number(random()))) * length
  );
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

function isAnyTwo(a, b, c) {
  return (
    (a === b && a !== c) ||
    (a === c && a !== b) ||
    (b === c && b !== a)
  );
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

        // Losing must be payout 0.
        // Since ANY2 = 1.5, two-match combos are not included here.
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

function threeMatchWinSpin(random = Math.random) {
  return [...weightedPick(WIN_COMBO_WEIGHTS, random).reels];
}

function twoMatchWinSpin(random = Math.random) {
  const picked = weightedPick(TWO_MATCH_SYMBOL_WEIGHTS, random).s;

  const otherSymbols = SLOT_DATA.reels[0]
    .map((item) => item.s)
    .filter((symbol) => symbol !== picked);

  const other = otherSymbols[randomIndex(otherSymbols.length, random)];

  const patterns = [
    [picked, picked, other],
    [picked, other, picked],
    [other, picked, picked],
  ];

  return [...patterns[randomIndex(patterns.length, random)]];
}

function winSpin(random = Math.random) {
  return Number(random()) < TWO_MATCH_IN_WIN_RATE / 100
    ? twoMatchWinSpin(random)
    : threeMatchWinSpin(random);
}

function vipSpin(rate = 90, random = Math.random) {
  if (Number(random()) < safeChance(rate)) {
    return winSpin(random);
  }

  return normalSpin(random);
}

/**
 * Owner-controlled RTP win-rate spin.
 *
 * Example:
 * /setrtp 35
 * - Win chance = 35%
 * - Lose chance = 65%
 * - Inside win 35%:
 *   - 85% two-match win, payout x1.5
 *   - 15% three-match win
 */
function controlledSpin(user, options = {}, random = Math.random) {
  const vipWinRate = percent(options.vipWinRate, 90);
  const rtpWinRate = percent(options.rtpWinRate, 35);
  const winRate = user?.isVip ? Math.max(vipWinRate, rtpWinRate) : rtpWinRate;

  return Number(random()) < winRate / 100
    ? winSpin(random)
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
  TWO_MATCH_SYMBOL_WEIGHTS,
  TWO_MATCH_IN_WIN_RATE,
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
