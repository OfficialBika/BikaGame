'use strict';

const userModel = require('../models/userModel');
const transactionModel = require('../models/transactionModel');
const { withRequiredTx } = require('../config/database');
const { logTx } = require('./transactionService');

function idVariants(userId) {
  const raw = String(userId ?? '').trim();
  if (!raw) return [];
  const out = [raw];
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    if (Number.isSafeInteger(n)) out.push(n);
  }
  return [...new Set(out)];
}

function positiveAmount(value) {
  const amount = Math.floor(Number(value));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
}

async function creditBalanceFromStars(userId, balanceAmount, meta = {}) {
  const amount = positiveAmount(balanceAmount);
  const chargeId = String(meta.paymentChargeId || '').trim();
  if (!amount || !chargeId) throw new Error('INVALID_STARS_CREDIT');

  return withRequiredTx(async (session) => {
    const opts = { session };
    const tx = transactionModel.collection();
    const markerId = `__stars_payment:${chargeId}`;
    const existing = await tx.findOne({ _id: markerId }, opts);
    if (existing) return { ok: true, duplicate: true, amount: Number(existing.amount || 0) };

    const user = await userModel.collection().findOneAndUpdate(
      { userId: { $in: idVariants(userId) } },
      {
        $inc: { balance: amount },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date(), totalWon: 0, totalLost: 0 },
      },
      { session, returnDocument: 'after', upsert: true }
    );
    const updatedUser = user?.value !== undefined ? user.value : user;
    if (!updatedUser) throw new Error('STARS_USER_CREDIT_FAILED');

    await logTx({
      type: 'stars_balance_purchase',
      fromUserId: 'TELEGRAM_STARS',
      toUserId: updatedUser.userId,
      amount,
      meta: { ...meta, paymentChargeId: chargeId, idempotencyKey: markerId },
    }, opts);

    await tx.insertOne({
      _id: markerId,
      type: 'stars_balance_purchase',
      userId: updatedUser.userId,
      amount,
      meta: { ...meta, paymentChargeId: chargeId, idempotencyKey: markerId },
      createdAt: new Date(),
    }, opts);

    return { ok: true, duplicate: false, amount, userId: updatedUser.userId };
  });
}

module.exports = { creditBalanceFromStars };
