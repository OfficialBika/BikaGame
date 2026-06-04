'use strict';

const { chance } = require('../services/vipService');

const SLOT_DATA = Object.freeze({
  reels: Object.freeze([
    Object.freeze([
      Object.freeze({ s: '🍒', w: 3200 }),
      Object.freeze({ s: '🍋', w: 2200 }),
      Object.freeze({ s: '🍉', w: 1500 }),
      Object.freeze({ s: '🔔', w: 900 }),
      Object.freeze({ s: '⭐', w: 450 }),
      Object.freeze({ s: 'BAR', w: 200 }),
      Object.freeze({ s: '7', w: 100 }),
    ]),
    Object.freeze([
      Object.freeze({ s: '🍒', w: 3200 }),
      Object.freeze({ s: '🍋', w: 2200 }),
      Object.freeze({ s: '🍉', w: 1500 }),
      Object.freeze({ s: '🔔', w: 900 }),
      Object.freeze({ s: '⭐', w: 450 }),
      Object.freeze({ s: 'BAR', w: 200 }),
      Object.freeze({ s: '7', w: 100 }),
    ]),
    Object.freeze([
      Object.freeze({ s: '🍒', w: 3200 }),
      Object.freeze({ s: '🍋', w: 2200 }),
      Object.freeze({ s: '🍉', w: 1500 }),
      Object.freeze({ s: '🔔', w: 900 }),
      Object.freeze({ s: '⭐', w: 450 }),
      Object.freeze({ s: 'BAR', w: 200 }),
      Object.freeze({ s: '7', w: 100 }),
    ]),
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

function normalizeRate(rate, fallback = 90) {
  const number = Number(rate);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, number));
}

function safeChance(rate) {
  try {
    const result = Number(chance(normalizeRate(rate)));
    if (Number.isFinite(result)) return Math.max(0, Math.min(1, result));
  } catch (_) {}

  return normalizeRate(rate) / 100;
}

function validateWeightedItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new TypeError('Slot reel must be a non-empty array');
  }

  for (const item of items) {
    if (!item || typeof item.s !== 'string' || item.s.length === 0) {
      throw new TypeError('Every slot symbol must contain a non-empty "s" string');
    }

    if (!Number.isFinite(Number(item.w)) || Number(item.w) <= 0) {
      throw new TypeError('Every slot symbol must contain a positive "w" weight');
    }
  }
}

function weightedPick(items, random = Math.random) {
  validateWeightedItems(items);

  const total = items.reduce((sum, item) => sum + Number(item.w), 0);
  let cursor = Math.max(0, Math.min(0.999999999999, Number(random()))) * total;

  for (const item of items) {
    cursor -= Number(item.w);
    if (cursor < 0) return item.s;
  }

  return items[items.length - 1].s;
}

function normalSpin(random = Math.random) {
  return SLOT_DATA.reels.map((reel) => weightedPick(reel, random));
}

function getWinningCombinations() {
  return Object.entries(SLOT_DATA.payouts)
    .filter(([key, payout]) => key !== 'ANY2' && Number(payout) > 0)
    .map(([key]) => key.split(','));
}

function vipSpin(rate = 90, random = Math.random) {
  const vipWinChance = safeChance(rate);

  if (Number(random()) < vipWinChance) {
    const wins = getWinningCombinations();

    if (wins.length > 0) {
      const index = Math.floor(
        Math.max(0, Math.min(0.999999999999, Number(random()))) * wins.length
      );

      return [...wins[index]];
    }
  }

  return normalSpin(random);
}

function spin(user, rate = 90, random = Math.random) {
  return user?.isVip ? vipSpin(rate, random) : normalSpin(random);
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
      throw new TypeError('Slot result contains an invalid symbol');
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

function calculatePayout(bet, reels) {
  const amount = Math.floor(Number(bet));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new TypeError('Bet must be a positive number');
  }

  return Math.floor(amount * multiplier(reels));
}

function displaySymbol(symbol) {
  if (symbol === '7') return '7️⃣';
  return symbol;
}

function art(reels) {
  validateReels(reels);

  const display = reels.map(displaySymbol);

  return [
    '┏━━━━━━━━━━━━━━━━━━┓',
    `┃  ${display[0]}  |  ${display[1]}  |  ${display[2]}  ┃`,
    '┗━━━━━━━━━━━━━━━━━━┛',
  ].join('\n');
}

function probabilityMap(reel) {
  validateWeightedItems(reel);

  const total = reel.reduce((sum, item) => sum + Number(item.w), 0);
  const map = new Map();

  for (const item of reel) {
    map.set(item.s, Number(item.w) / total);
  }

  return map;
}

function baseRtp() {
  const maps = SLOT_DATA.reels.map(probabilityMap);
  let expectedMultiplier = 0;

  for (const [a, pa] of maps[0]) {
    for (const [b, pb] of maps[1]) {
      for (const [c, pc] of maps[2]) {
        expectedMultiplier += pa * pb * pc * multiplier([a, b, c]);
      }
    }
  }

  return expectedMultiplier;
}

module.exports = {
  SLOT_DATA,
  weightedPick,
  normalSpin,
  vipSpin,
  spin,
  isAnyTwo,
  multiplier,
  calculatePayout,
  art,
  baseRtp,
};
