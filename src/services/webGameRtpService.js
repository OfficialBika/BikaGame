'use strict';

const { getDb } = require('../config/database');

const GAME_RTP_KEY_PREFIX = 'web_game_rtp_';

const DEFAULT_RTPS = Object.freeze({
  rocket: Number(process.env.WEB_ROCKET_RTP || 76),
  plinko: Number(process.env.WEB_PLINKO_RTP || 72),
  wheel: Number(process.env.WEB_WHEEL_RTP || 70),
  mines: Number(process.env.WEB_MINES_RTP || 68),
  blackjack: Number(process.env.WEB_BLACKJACK_RTP || process.env.WEB_BJ_RTP || 68),
});

const GAME_LABELS = Object.freeze({
  rocket: 'Rocket',
  plinko: 'Plinko',
  wheel: 'Lucky Wheel',
  mines: 'Web Mines',
  blackjack: 'Web Blackjack',
});

function cleanGameKey(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (key === 'rocket' || key === 'crash' || key === 'webcrash') return 'rocket';
  if (key === 'plinko' || key === 'plink') return 'plinko';
  if (key === 'wheel' || key === 'luckywheel' || key === 'spin') return 'wheel';
  if (key === 'mines' || key === 'mine' || key === 'webmines') return 'mines';
  if (key === 'blackjack' || key === 'bj' || key === 'webbj' || key === 'webblackjack') return 'blackjack';
  return key;
}

function clampRtp(value, fallback = 70) {
  const raw = String(value ?? '').replace('%', '').trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return Math.max(40, Math.min(95, Number(fallback) || 70));
  return Math.max(40, Math.min(95, Math.floor(n)));
}

function configCollection() {
  return getDb().collection('config');
}

function configKey(gameKey) {
  return `${GAME_RTP_KEY_PREFIX}${cleanGameKey(gameKey)}`;
}

function defaultRtp(gameKey) {
  const key = cleanGameKey(gameKey);
  return clampRtp(DEFAULT_RTPS[key], 70);
}

async function getWebGameRtp(gameKey) {
  const key = cleanGameKey(gameKey);
  const fallback = defaultRtp(key);

  try {
    const doc = await configCollection().findOne({ key: configKey(key) });
    return clampRtp(doc?.value, fallback);
  } catch (_) {
    return fallback;
  }
}

async function setWebGameRtp(gameKey, value, updatedBy = null) {
  const key = cleanGameKey(gameKey);
  if (!GAME_LABELS[key]) throw new Error('WEB_GAME_UNKNOWN');
  const rtp = clampRtp(value, defaultRtp(key));

  await configCollection().updateOne(
    { key: configKey(key) },
    {
      $set: {
        key: configKey(key),
        game: key,
        value: rtp,
        updatedBy: updatedBy || null,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  return rtp;
}

async function getAllWebGameRtps() {
  const result = {};
  for (const key of Object.keys(GAME_LABELS)) {
    result[key] = await getWebGameRtp(key);
  }
  return result;
}

function gameLabel(gameKey) {
  return GAME_LABELS[cleanGameKey(gameKey)] || String(gameKey || 'Game');
}

module.exports = {
  cleanGameKey,
  clampRtp,
  getWebGameRtp,
  setWebGameRtp,
  getAllWebGameRtps,
  gameLabel,
  defaultRtp,
  GAME_LABELS,
};
