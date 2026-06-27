'use strict';

const { getDb } = require('../config/database');

let indexesReady = false;

function collection() {
  return getDb().collection('daily_tournaments');
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function floor(value) {
  return Math.floor(number(value));
}

function yangonDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function ensureIndexes() {
  if (indexesReady) return;

  try {
    const col = collection();
    await col.createIndex(
      { dayKey: 1, game: 1, chatId: 1, userId: 1 },
      { unique: true, name: 'day_game_chat_user_unique' }
    );
    await col.createIndex(
      { dayKey: 1, game: 1, chatId: 1, score: -1, bestWin: -1 },
      { name: 'daily_tournament_rank_lookup' }
    );
    indexesReady = true;
  } catch (err) {
    console.warn('DAILY_TOURNAMENT_INDEX_WARNING:', err?.message || err);
  }
}

function normalizeUser(user) {
  return {
    userId: user?.id || user?.userId || null,
    username: user?.username ? String(user.username).toLowerCase() : null,
    firstName: user?.first_name || user?.firstName || null,
    lastName: user?.last_name || user?.lastName || null,
  };
}

async function recordDailyTournament(input = {}) {
  const game = String(input.game || 'mines').toLowerCase();
  const chatId = input.chatId;
  const user = normalizeUser(input.user);

  if (!chatId || !user.userId) return null;

  await ensureIndexes();

  const dayKey = input.dayKey || yangonDayKey(new Date());
  const bet = Math.max(0, floor(input.bet));
  const payout = Math.max(0, floor(input.payout));
  const net = floor(input.net ?? (payout - bet));
  const positiveScore = Math.max(0, net);
  const bestWin = Math.max(0, net);
  const multiplier = Math.max(0, number(input.multiplier));
  const now = new Date();

  return collection().updateOne(
    {
      dayKey,
      game,
      chatId,
      userId: user.userId,
    },
    {
      $set: {
        dayKey,
        game,
        chatId,
        userId: user.userId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        updatedAt: now,
      },
      $inc: {
        score: positiveScore,
        totalBet: bet,
        totalPayout: payout,
        totalNet: net,
        games: 1,
        wins: net > 0 ? 1 : 0,
        losses: net <= 0 ? 1 : 0,
      },
      $max: {
        bestWin,
        bestPayout: payout,
        bestMultiplier: multiplier,
      },
      $push: {
        recent: {
          $each: [{
            at: now,
            bet,
            payout,
            net,
            multiplier,
            meta: input.meta || {},
          }],
          $slice: -10,
        },
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );
}

async function getDailyTournament({ game = 'mines', chatId, limit = 10, dayKey = null } = {}) {
  if (!chatId) return [];

  await ensureIndexes();

  return collection()
    .find({
      dayKey: dayKey || yangonDayKey(new Date()),
      game: String(game || 'mines').toLowerCase(),
      chatId,
    })
    .sort({ score: -1, bestWin: -1, totalPayout: -1, updatedAt: 1 })
    .limit(Math.max(1, Math.min(50, Number(limit) || 10)))
    .toArray();
}

module.exports = {
  recordDailyTournament,
  getDailyTournament,
  yangonDayKey,
};
