'use strict';

const userModel = require('../models/userModel');
const { withRequiredTx, col } = require('../config/database');
const { logTx } = require('./transactionService');

const STAR_TO_BAL = 60000;
const PACKAGES = Object.freeze([10, 20, 30, 40, 50, 100]);

function packageBal(stars) {
  return Number(stars) * STAR_TO_BAL;
}

function isValidPackage(stars) {
  return Number.isInteger(Number(stars)) && PACKAGES.includes(Number(stars));
}

function payloadFor(stars, userId, screenMessageId) {
  const data = {
    v: 1,
    kind: 'bal_purchase',
    stars: Number(stars),
    userId: String(userId),
  };
  const messageId = Number(screenMessageId);
  if (Number.isSafeInteger(messageId) && messageId > 0) {
    data.screenMessageId = messageId;
  }
  return JSON.stringify(data);
}

function parsePayload(payload) {
  try {
    const data = JSON.parse(String(payload || ''));
    if (data?.v !== 1 || data?.kind !== 'bal_purchase' || !isValidPackage(data?.stars) || !data?.userId) {
      return null;
    }

    const messageId = Number(data.screenMessageId);
    return {
      stars: Number(data.stars),
      userId: String(data.userId),
      screenMessageId: Number.isSafeInteger(messageId) && messageId > 0 ? messageId : null,
    };
  } catch (_) {
    return null;
  }
}

async function creditSuccessfulPayment({ userId, stars, bal, chargeId, payload }) {
  if (!userId || !isValidPackage(stars) || Number(bal) !== packageBal(stars) || !chargeId) {
    throw new Error('INVALID_STARS_PAYMENT');
  }

  const amount = packageBal(stars);
  const markerId = '__stars_purchase:' + String(chargeId);

  return withRequiredTx(async (session) => {
    const opts = { session };
    const tx = col('financial_settlements');
    const paymentMarkers = col('stars_payment_idempotency');
    const existing = await tx.findOne({ _id: markerId }, opts);
    if (existing) return { ok: true, duplicate: true, stars, bal: amount };
    const priorCharge = await paymentMarkers.findOne({ _id: String(chargeId) }, opts);
    if (priorCharge) return { ok: true, duplicate: true, stars, bal: amount };

    const userIdText = String(userId);
    const userIds = [userIdText];
    if (/^\d+$/.test(userIdText)) userIds.push(Number(userIdText));
    const user = await userModel.collection().findOneAndUpdate(
      { userId: { $in: userIds } },
      { $inc: { balance: amount }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' },
    );
    const actualUser = user?.value !== undefined ? user.value : user;
    if (!actualUser) throw new Error('STARS_USER_NOT_FOUND');

    await logTx({
      type: 'stars_bal_purchase',
      fromUserId: 'TELEGRAM_STARS',
      toUserId: actualUser.userId,
      amount,
      meta: {
        stars,
        exchangeRate: STAR_TO_BAL,
        telegramPaymentChargeId: String(chargeId),
        invoicePayload: String(payload || ''),
        idempotencyKey: markerId,
      },
    }, opts);

    // Keep the external Telegram charge ID permanently deduplicated, outside
    // the seven-day settlement-marker retention window.
    await paymentMarkers.insertOne({
      _id: String(chargeId),
      type: 'telegram_stars_purchase',
      userId: actualUser.userId,
      stars,
      bal: amount,
      payload: String(payload || ''),
      createdAt: new Date(),
    }, opts);

    const settlementMarker = {
      _id: markerId,
      type: '__stars_purchase_marker',
      userId: actualUser.userId,
      stars,
      bal: amount,
      telegramPaymentChargeId: String(chargeId),
      meta: { idempotencyKey: markerId },
      createdAt: new Date(),
    };
    await tx.insertOne(settlementMarker, opts);
    await logTx(settlementMarker, opts);

    return { ok: true, duplicate: false, stars, bal: amount, user: actualUser };
  });
}

module.exports = {
  STAR_TO_BAL,
  PACKAGES,
  packageBal,
  isValidPackage,
  payloadFor,
  parsePayload,
  creditSuccessfulPayment,
};
