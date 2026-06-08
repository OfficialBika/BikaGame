'use strict';

const { chance } = require('../services/vipService');

const SLOT_DATA = Object.freeze({
  reels: Object.freeze([
    Object.freeze([{s:'🍒',w:3200},{s:'🍋',w:2200},{s:'🍉',w:1500},{s:'🔔',w:900},{s:'⭐',w:450},{s:'BAR',w:200},{s:'7',w:100}].map(Object.freeze)),
    Object.freeze([{s:'🍒',w:3200},{s:'🍋',w:2200},{s:'🍉',w:1500},{s:'🔔',w:900},{s:'⭐',w:450},{s:'BAR',w:200},{s:'7',w:100}].map(Object.freeze)),
    Object.freeze([{s:'🍒',w:3200},{s:'🍋',w:2200},{s:'🍉',w:1500},{s:'🔔',w:900},{s:'⭐',w:450},{s:'BAR',w:200},{s:'7',w:100}].map(Object.freeze)),
  ]),
  payouts: Object.freeze({'7,7,7':20,'BAR,BAR,BAR':15,'⭐,⭐,⭐':12,'🔔,🔔,🔔':9,'🍉,🍉,🍉':7,'🍋,🍋,🍋':5,'🍒,🍒,🍒':3,ANY2:1.5}),
});

function percent(v, fallback = 35) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function safeChance(rate) {
  try {
    const r = Number(chance(percent(rate, 90)));
    if (Number.isFinite(r)) return Math.max(0, Math.min(1, r));
  } catch (_) {}
  return percent(rate, 90) / 100;
}

function weightedPick(items, random = Math.random) {
  const total = items.reduce((a, x) => a + Number(x.w), 0);
  let r = Math.max(0, Math.min(0.999999999999, Number(random()))) * total;
  for (const it of items) {
    r -= Number(it.w);
    if (r < 0) return it.s;
  }
  return items[items.length - 1].s;
}

function normalSpin(random = Math.random) {
  return SLOT_DATA.reels.map((reel) => weightedPick(reel, random));
}

function isAnyTwo(a, b, c) {
  return (a === b && a !== c) || (a === c && a !== b) || (b === c && b !== a);
}

function validateReels(reels) {
  if (!Array.isArray(reels) || reels.length !== 3) throw new TypeError('Slot result must contain exactly 3 reels');
}

function multiplier(reels) {
  validateReels(reels);
  const key = reels.join(',');
  if (Object.prototype.hasOwnProperty.call(SLOT_DATA.payouts, key)) return Number(SLOT_DATA.payouts[key]) || 0;
  return isAnyTwo(reels[0], reels[1], reels[2]) ? Number(SLOT_DATA.payouts.ANY2) || 0 : 0;
}

function getWinningCombinations() {
  return Object.entries(SLOT_DATA.payouts).filter(([k, v]) => k !== 'ANY2' && Number(v) > 0).map(([k]) => k.split(','));
}

function getLosingCombinations() {
  const symbols = SLOT_DATA.reels[0].map((x) => x.s);
  const list = [];
  for (const a of symbols) for (const b of symbols) for (const c of symbols) {
    const reels = [a, b, c];
    if (multiplier(reels) === 0) list.push(reels);
  }
  return list;
}

function pick(list, random = Math.random) {
  return [...list[Math.floor(Math.max(0, Math.min(0.999999999999, Number(random()))) * list.length)]];
}

function vipSpin(rate = 90, random = Math.random) {
  if (Number(random()) < safeChance(rate)) return pick(getWinningCombinations(), random);
  return normalSpin(random);
}

function controlledSpin(user, options = {}, random = Math.random) {
  const vipWinRate = percent(options.vipWinRate, 90);
  const rtpWinRate = percent(options.rtpWinRate, 35);
  const winRate = user?.isVip ? Math.max(vipWinRate, rtpWinRate) : rtpWinRate;
  return Number(random()) < winRate / 100 ? pick(getWinningCombinations(), random) : pick(getLosingCombinations(), random);
}

function spin(user, vipWinRate = 90, random = Math.random, rtpWinRate = null) {
  if (rtpWinRate != null) return controlledSpin(user, { vipWinRate, rtpWinRate }, random);
  return user?.isVip ? vipSpin(vipWinRate, random) : normalSpin(random);
}

function calculatePayout(bet, reels) {
  const amount = Math.floor(Number(bet));
  if (!Number.isFinite(amount) || amount <= 0) throw new TypeError('Bet must be a positive number');
  return Math.floor(amount * multiplier(reels));
}

function art(reels) {
  validateReels(reels);
  const box = (x) => x === '7' ? '7️⃣' : x;
  return ['┏━━━━━━━━━━━━━━━━━━┓', `┃  ${box(reels[0])}  |  ${box(reels[1])}  |  ${box(reels[2])}  ┃`, '┗━━━━━━━━━━━━━━━━━━┛'].join('\n');
}

function baseRtp() {
  return 0;
}

module.exports = { SLOT_DATA, weightedPick, normalSpin, vipSpin, controlledSpin, spin, isAnyTwo, multiplier, calculatePayout, art, baseRtp };
