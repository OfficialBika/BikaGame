'use strict';

const userModel = require('../models/userModel');
const treasuryModel = require('../models/treasuryModel');
const { withRequiredTx } = require('../config/database');
const { toNum } = require('../utils/format');
const { logTx } = require('./transactionService');

function amount(value) {
  const n = Math.floor(toNum(value));
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error('INVALID_AMOUNT');
  return n;
}

function txFilter(meta = {}) {
  const type = String(meta.type || 'money_tx');
  const key = meta.idempotencyKey == null ? null : String(meta.idempotencyKey);
  if (key) return { type, 'meta.idempotencyKey': key };
  return null;
}

async function creditUser(toUserId, rawAmount, meta = {}) {
  const amt = amount(rawAmount);
  const filter = txFilter(meta);

  return withRequiredTx(async (session) => {
    const opts = { session };
    if (filter) {
      const existing = await treasuryModel.collection().findOne(filter, opts);
      if (existing) return { ok: true, duplicate: true };
    }

    const treasury = await treasuryModel.collection().findOneAndUpdate(
      { key: 'treasury', ownerBalance: { $gte: amt } },
      { $inc: { ownerBalance: -amt }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    );
    if (!treasury) throw new Error('TREASURY_INSUFFICIENT');

    const user = await userModel.collection().updateOne(
      { userId: toUserId },
      {
        $inc: { balance: amt, totalWon: String(meta.type || '').includes('win') ? amt : 0 },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { session, upsert: true }
    );
    if (user.matchedCount !== 1 && user.upsertedCount !== 1) throw new Error('USER_CREDIT_FAILED');

    await logTx({
      type: meta.type || 'treasury_pay',
      fromUserId: 'TREASURY',
      toUserId,
      amount: amt,
      meta,
    }, opts);

    return { ok: true, duplicate: false };
  });
}

async function debitUser(fromUserId, rawAmount, meta = {}) {
  const amt = amount(rawAmount);
  const filter = txFilter(meta);

  return withRequiredTx(async (session) => {
    const opts = { session };
    if (filter) {
      const existing = await treasuryModel.collection().findOne(filter, opts);
      if (existing) return { ok: true, duplicate: true };
    }

    const user = await userModel.collection().findOneAndUpdate(
      { userId: { $in: [String(fromUserId), Number(fromUserId)] }, balance: { $gte: amt } },
      { $inc: { balance: -amt, totalLost: String(meta.type || '').includes('bet') ? amt : 0 }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    );
    if (!user) throw new Error('USER_INSUFFICIENT');

    await treasuryModel.collection().updateOne(
      { key: 'treasury' },
      { $inc: { ownerBalance: amt }, $set: { updatedAt: new Date() } },
      opts
    );

    await logTx({
      type: meta.type || 'treasury_receive',
      fromUserId: user.userId,
      toUserId: 'TREASURY',
      amount: amt,
      meta,
    }, opts);

    return { ok: true, duplicate: false };
  });
}

async function transferUser(fromUserId, toUserId, rawAmount, meta = {}) {
  const amt = amount(rawAmount);
  const filter = txFilter(meta);

  return withRequiredTx(async (session) => {
    const opts = { session };
    if (filter) {
      const existing = await userModel.collection().findOne(filter, opts);
      if (existing) return { ok: true, duplicate: true };
    }

    const sender = await userModel.collection().findOneAndUpdate(
      { userId: { $in: [String(fromUserId), Number(fromUserId)] }, balance: { $gte: amt } },
      { $inc: { balance: -amt }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    );
    if (!sender) throw new Error('INSUFFICIENT');

    const recipient = await userModel.collection().findOne({ userId: { $in: [String(toUserId), Number(toUserId)] } }, opts);
    const recipientId = recipient?.userId ?? toUserId;

    await userModel.collection().updateOne(
      { userId: recipientId },
      { $inc: { balance: amt }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { session, upsert: true }
    );

    await logTx({
      type: meta.type || 'gift',
      fromUserId: sender.userId,
      toUserId: recipientId,
      amount: amt,
      meta,
    }, opts);

    return { ok: true, duplicate: false };
  });
}

module.exports = { creditUser, debitUser, transferUser };
