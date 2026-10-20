'use strict';

const { env } = require('../config/env');
const { toNum } = require('../utils/format');
const treasuryModel = require('../models/treasuryModel');
const { isDbOneWriteBlocked } = require('../config/database');
const logger = require('../utils/logger');

function clampPercent(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

async function ensureTreasury() {
  const c = treasuryModel.collection();
  const exist = await c.findOne({ key: 'treasury' });

  if (exist) {
    // Read-only fast path. Do not rewrite the treasury document on every
    // Telegram update because game settlements also update this same document.
    // Repeated writes here caused unnecessary lock/transaction contention.
    return {
      ...exist,
      totalSupply: toNum(exist.totalSupply),
      ownerBalance: toNum(exist.ownerBalance),
      ownerUserId: exist.ownerUserId || env.OWNER_ID,
      maintenanceMode: typeof exist.maintenanceMode === 'boolean' ? exist.maintenanceMode : false,
      vipWinRate: clampPercent(exist.vipWinRate, 90),
      rtpWinRate: clampPercent(exist.rtpWinRate, 35),
    };
  }

  // When Atlas has blocked all DB1 writes due to quota exhaustion, do not make
  // startup depend on creating a missing treasury row. All money operations are
  // separately guarded by the transaction layer until writes become available.
  if (isDbOneWriteBlocked()) {
    logger.error('Treasury initialization skipped: DB1 is write-blocked by Atlas quota.');
    return null;
  }

  await c.insertOne({
    key: 'treasury',
    ownerUserId: env.OWNER_ID,
    totalSupply: 0,
    ownerBalance: 0,
    maintenanceMode: false,
    vipWinRate: 90,
    rtpWinRate: 35,
    broadcastRunning: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.findOne({ key: 'treasury' });
}

async function getTreasury() {
  return treasuryModel.collection().findOne({ key: 'treasury' });
}

function isOwner(ctx, t) {
  return !!(
    t?.ownerUserId &&
    ctx.from?.id != null &&
    String(ctx.from.id) === String(t.ownerUserId)
  );
}

async function setTotalSupply(amount) {
  const amt = Math.max(0, Math.floor(toNum(amount)));
  await treasuryModel.collection().updateOne(
    { key: 'treasury' },
    { $set: { totalSupply: amt, ownerBalance: amt, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function setMaintenance(on) {
  await treasuryModel.collection().updateOne(
    { key: 'treasury' },
    { $set: { maintenanceMode: !!on, updatedAt: new Date() } },
    { upsert: true }
  );
}

async function setVipWinRate(rate) {
  const n = clampPercent(rate, 90);
  await treasuryModel.collection().updateOne(
    { key: 'treasury' },
    { $set: { vipWinRate: n, updatedAt: new Date() } },
    { upsert: true }
  );
  return n;
}

async function setRtpWinRate(rate) {
  const n = clampPercent(rate, 35);
  await treasuryModel.collection().updateOne(
    { key: 'treasury' },
    { $set: { rtpWinRate: n, updatedAt: new Date() } },
    { upsert: true }
  );
  return n;
}

module.exports = { ensureTreasury, getTreasury, isOwner, setTotalSupply, setMaintenance, setVipWinRate, setRtpWinRate };
