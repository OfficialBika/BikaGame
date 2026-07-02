'use strict';

const { getDb } = require('../config/database');

const COLLECTION = 'web_game_history';
const TTL_SECONDS = Math.max(3600, Number(process.env.WEB_GAME_HISTORY_TTL_SECONDS || 24 * 60 * 60));
let indexPromise = null;

function collection() {
  return getDb().collection(COLLECTION);
}

function cleanUserId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function normalizeGame(game) {
  const key = String(game || '').toLowerCase().trim();
  if (['rocket', 'crash', 'web_crash'].includes(key)) return 'rocket';
  if (['slot', 'web_slot'].includes(key)) return 'slot';
  if (['plinko', 'web_plinko'].includes(key)) return 'plinko';
  if (['wheel', 'lucky_wheel', 'web_wheel'].includes(key)) return 'wheel';
  if (['mines', 'web_mines'].includes(key)) return 'mines';
  if (['blackjack', 'bj', 'web_bj', 'web_blackjack'].includes(key)) return 'blackjack';
  if (['shan', 'shankoe', 'shankoemee', 'koemee', 'web_shan', 'skm'].includes(key)) return 'shan';
  return key || 'unknown';
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureIndexes() {
  if (!indexPromise) {
    indexPromise = Promise.all([
      collection().createIndex({ createdAt: 1 }, { expireAfterSeconds: TTL_SECONDS, name: 'ttl_createdAt_24h' }).catch((err) => {
        if ([85, 86].includes(err?.code) || ['IndexOptionsConflict', 'IndexKeySpecsConflict'].includes(err?.codeName)) return null;
        throw err;
      }),
      collection().createIndex({ userId: 1, game: 1, createdAt: -1 }, { name: 'user_game_createdAt' }).catch(() => null),
    ]);
  }
  return indexPromise;
}

async function recordWebGameHistory(entry = {}) {
  try {
    const userId = cleanUserId(entry.userId);
    if (!userId) return null;
    await ensureIndexes();
    const now = new Date();
    const bet = Math.floor(safeNumber(entry.bet, 0));
    const payout = Math.floor(safeNumber(entry.payout, 0));
    const net = Number.isFinite(Number(entry.net)) ? Math.floor(Number(entry.net)) : payout - bet;
    const doc = {
      userId,
      game: normalizeGame(entry.game),
      title: String(entry.title || '').slice(0, 80),
      outcome: String(entry.outcome || (payout > bet ? 'win' : payout > 0 ? 'paid' : 'lose')).slice(0, 32),
      bet,
      payout,
      net,
      multiplier: entry.multiplier == null ? null : safeNumber(entry.multiplier, 0),
      label: entry.label == null ? null : String(entry.label).slice(0, 32),
      roundNo: entry.roundNo == null ? null : Math.floor(safeNumber(entry.roundNo, 0)),
      meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
      createdAt: now,
      createdAtMs: now.getTime(),
    };
    await collection().insertOne(doc);
    return doc;
  } catch (err) {
    console.error('WEB_GAME_HISTORY_RECORD_FAILED:', err?.message || err);
    return null;
  }
}

async function getWebGameHistory(userId, game = 'all', limit = 20) {
  const finalUserId = cleanUserId(userId);
  if (!finalUserId) throw new Error('INVALID_USER');
  await ensureIndexes();
  const query = { userId: finalUserId };
  const normalized = normalizeGame(game);
  if (normalized && normalized !== 'all') query.game = normalized;
  const docs = await collection()
    .find(query)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(50, Number(limit) || 20)))
    .toArray();

  return docs.map((doc) => ({
    id: String(doc._id),
    game: doc.game,
    title: doc.title,
    outcome: doc.outcome,
    bet: Number(doc.bet || 0),
    payout: Number(doc.payout || 0),
    net: Number(doc.net || 0),
    multiplier: doc.multiplier == null ? null : Number(doc.multiplier || 0),
    label: doc.label || null,
    roundNo: doc.roundNo || null,
    createdAt: doc.createdAt,
    createdAtMs: Number(doc.createdAtMs || 0),
    meta: doc.meta || {},
  }));
}

module.exports = {
  recordWebGameHistory,
  getWebGameHistory,
};
