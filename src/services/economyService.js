const userModel = require('../models/userModel');
const treasuryModel = require('../models/treasuryModel');
const { withRequiredTx } = require('../config/database');
const { toNum } = require('../utils/format');
const { logTx } = require('./transactionService');
const transactionModel = require('../models/transactionModel');

function extract(res) { return res?.value !== undefined ? res.value : res; }
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

async function getUser(userId) {
  const ids = idVariants(userId);
  if (!ids.length) return null;
  return userModel.collection().findOne({ userId: { $in: ids } });
}

async function getUserByUsername(username) {
  return userModel.collection().findOne({ username: String(username).toLowerCase() });
}

async function ensureUser(tgUser) {
  const now = new Date();
  const incomingId = tgUser.id ?? tgUser.userId;
  const existing = await getUser(incomingId);
  const userId = existing?.userId ?? incomingId;
  const doc = {
    userId,
    username: tgUser.username ? String(tgUser.username).toLowerCase() : null,
    firstName: tgUser.first_name || tgUser.firstName || null,
    lastName: tgUser.last_name || tgUser.lastName || null,
    ...(tgUser.photo_url || tgUser.photoUrl ? { photoUrl: tgUser.photo_url || tgUser.photoUrl } : {}),
    updatedAt: now,
  };
  await userModel.collection().updateOne(
    { userId },
    {
      $set: doc,
      $setOnInsert: {
        balance: 0, totalWon: 0, totalLost: 0, createdAt: now,
        startBonusClaimed: false, lastDailyClaimAt: null, isVip: false, startedBot: false,
      },
    },
    { upsert: true }
  );
  return getUser(userId);
}

async function markStarted(userId) {
  const u = await getUser(userId);
  if (u) await userModel.collection().updateOne({ _id: u._id }, { $set: { startedBot: true, updatedAt: new Date() } });
}

function positiveAmount(value) {
  const amt = Math.floor(toNum(value));
  if (!Number.isSafeInteger(amt) || amt <= 0) return 0;
  return amt;
}

function idempotencyKey(meta = {}) {
  return meta.idempotencyKey == null ? null : String(meta.idempotencyKey);
}

function txLookup(type, key) {
  return key ? { type, 'meta.idempotencyKey': key } : null;
}

async function treasuryPayToUser(toUserId, amount, meta = {}) {
  const amt = positiveAmount(amount);
  if (!amt) return;
  const type = meta.type || 'treasury_pay';
  const idem = idempotencyKey(meta);

  return withRequiredTx(async (session) => {
    const opts = { session };
    if (idem && await transactionModel.collection().findOne(txLookup(type, idem), opts)) return { ok: true, duplicate: true };

    const t = extract(await treasuryModel.collection().findOneAndUpdate(
      { key: 'treasury', ownerBalance: { $gte: amt } },
      { $inc: { ownerBalance: -amt }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    ));
    if (!t) throw new Error('TREASURY_INSUFFICIENT');

    const u = await userModel.collection().updateOne(
      { userId: toUserId },
      {
        $inc: { balance: amt, totalWon: String(type).includes('win') ? amt : 0 },
        $set: { updatedAt: new Date() },
        $setOnInsert: { createdAt: new Date() },
      },
      { session, upsert: true }
    );
    if (u.matchedCount !== 1 && u.upsertedCount !== 1) throw new Error('USER_CREDIT_FAILED');

    await logTx({ type, fromUserId: 'TREASURY', toUserId, amount: amt, meta }, opts);
    return { ok: true, duplicate: false };
  });
}

async function userPayToTreasury(fromUserId, amount, meta = {}) {
  const amt = positiveAmount(amount);
  if (!amt) return;
  const type = meta.type || 'treasury_receive';
  const idem = idempotencyKey(meta);

  return withRequiredTx(async (session) => {
    const opts = { session };
    if (idem && await transactionModel.collection().findOne(txLookup(type, idem), opts)) return { ok: true, duplicate: true };

    const u = extract(await userModel.collection().findOneAndUpdate(
      { userId: { $in: idVariants(fromUserId) }, balance: { $gte: amt } },
      { $inc: { balance: -amt, totalLost: String(type).includes('bet') ? amt : 0 }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    ));
    if (!u) throw new Error('USER_INSUFFICIENT');

    const treasury = extract(await treasuryModel.collection().findOneAndUpdate(
      { key: 'treasury' },
      { $inc: { ownerBalance: amt }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    ));
    if (!treasury) throw new Error('TREASURY_NOT_FOUND');

    await logTx({ type, fromUserId: u.userId, toUserId: 'TREASURY', amount: amt, meta }, opts);
    return { ok: true, duplicate: false };
  });
}

async function transferBalance(fromUserId, toUserId, amount, meta = {}) {
  const amt = positiveAmount(amount);
  if (!amt) return;
  const type = meta.type || 'gift';
  const idem = idempotencyKey(meta);

  return withRequiredTx(async (session) => {
    const opts = { session };
    if (idem && await transactionModel.collection().findOne(txLookup(type, idem), opts)) return { ok: true, duplicate: true };

    const sender = extract(await userModel.collection().findOneAndUpdate(
      { userId: { $in: idVariants(fromUserId) }, balance: { $gte: amt } },
      { $inc: { balance: -amt }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    ));
    if (!sender) throw new Error('INSUFFICIENT');

    const recipient = await getUser(toUserId);
    const recipientId = recipient?.userId ?? toUserId;

    await userModel.collection().updateOne(
      { userId: recipientId },
      { $inc: { balance: amt }, $set: { updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { session, upsert: true }
    );

    await logTx({
      type,
      fromUserId: sender.userId,
      toUserId: recipientId,
      amount: amt,
      meta: { ...meta, transferMeta: { idempotencyKey: idem || null } },
    }, opts);

    return { ok: true, duplicate: false };
  });
}

async function settleSingleGame({ settlementId, typePrefix, userId, bet = 0, payout = 0, meta = {} }) {
  const amount = positiveAmount(bet);
  const reward = positiveAmount(payout);
  if (!settlementId || !typePrefix || !userId) throw new Error('INVALID_GAME_SETTLEMENT');

  return withRequiredTx(async (session) => {
    const opts = { session };
    const tx = transactionModel.collection();
    const markerId = `__settlement:${String(typePrefix)}:${String(settlementId)}`;
    const existing = await tx.findOne({ _id: markerId }, opts);
    if (existing) return { ok: true, duplicate: true, payout: Number(existing.payout || 0) };

    let actualUserId = userId;

    if (amount > 0) {
      const user = extract(await userModel.collection().findOneAndUpdate(
        { userId: { $in: idVariants(userId) }, balance: { $gte: amount } },
        { $inc: { balance: -amount, totalLost: amount }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!user) throw new Error('USER_INSUFFICIENT');
      actualUserId = user.userId;

      const treasury = extract(await treasuryModel.collection().findOneAndUpdate(
        { key: 'treasury' },
        { $inc: { ownerBalance: amount }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!treasury) throw new Error('TREASURY_NOT_FOUND');

      await logTx({
        type: `${String(typePrefix)}_bet`,
        fromUserId: actualUserId,
        toUserId: 'TREASURY',
        amount,
        meta: { ...meta, settlementId: String(settlementId), idempotencyKey: `${markerId}:bet` },
      }, opts);
    }

    if (reward > 0) {
      const treasury = extract(await treasuryModel.collection().findOneAndUpdate(
        { key: 'treasury', ownerBalance: { $gte: reward } },
        { $inc: { ownerBalance: -reward }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!treasury) throw new Error('TREASURY_INSUFFICIENT');

      const user = extract(await userModel.collection().findOneAndUpdate(
        { userId: { $in: idVariants(userId) } },
        { $inc: { balance: reward, totalWon: reward }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!user) throw new Error('PAYOUT_USER_NOT_FOUND');
      actualUserId = user.userId;

      await logTx({
        type: `${String(typePrefix)}_win`,
        fromUserId: 'TREASURY',
        toUserId: actualUserId,
        amount: reward,
        meta: { ...meta, settlementId: String(settlementId), idempotencyKey: `${markerId}:win` },
      }, opts);
    }

    await tx.insertOne({
      _id: markerId,
      type: `${String(typePrefix)}_settlement`,
      settlementId: String(settlementId),
      userId: actualUserId,
      bet: amount,
      payout: reward,
      meta: { ...meta, idempotencyKey: markerId },
      createdAt: new Date(),
    }, opts);

    return { ok: true, duplicate: false, payout: reward };
  });
}

async function settleMultiPayouts({ settlementId, typePrefix, payouts = [], meta = {} }) {
  if (!settlementId || !typePrefix || !Array.isArray(payouts)) throw new Error('INVALID_MULTI_SETTLEMENT');
  const normalized = payouts.map((p) => ({ userId: p?.userId, amount: positiveAmount(p?.amount) })).filter((p) => p.amount > 0);

  return withRequiredTx(async (session) => {
    const opts = { session };
    const tx = transactionModel.collection();
    const markerId = `__settlement:${String(typePrefix)}:${String(settlementId)}`;
    const existing = await tx.findOne({ _id: markerId }, opts);
    if (existing) return { ok: true, duplicate: true, paid: existing.payouts || [] };

    const total = normalized.reduce((sum, item) => sum + item.amount, 0);
    if (total > 0) {
      const treasury = extract(await treasuryModel.collection().findOneAndUpdate(
        { key: 'treasury', ownerBalance: { $gte: total } },
        { $inc: { ownerBalance: -total }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!treasury) throw new Error('TREASURY_INSUFFICIENT');
    }

    const paid = [];
    for (const item of normalized) {
      const user = extract(await userModel.collection().findOneAndUpdate(
        { userId: { $in: idVariants(item.userId) } },
        { $inc: { balance: item.amount, totalWon: item.amount }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!user) throw new Error('PAYOUT_USER_NOT_FOUND');
      paid.push({ userId: user.userId, amount: item.amount });
      await logTx({
        type: `${String(typePrefix)}_win`,
        fromUserId: 'TREASURY',
        toUserId: user.userId,
        amount: item.amount,
        meta: { ...meta, settlementId: String(settlementId), idempotencyKey: `${markerId}:win:${String(user.userId)}` },
      }, opts);
    }

    await tx.insertOne({
      _id: markerId,
      type: `${String(typePrefix)}_settlement`,
      settlementId: String(settlementId),
      payouts: paid,
      payout: total,
      meta: { ...meta, idempotencyKey: markerId },
      createdAt: new Date(),
    }, opts);

    return { ok: true, duplicate: false, paid };
  });
}

async function settleDuel({ duelId, typePrefix, challengerId, targetUserId, winnerUserId = null, bet, payout = 0, meta = {} }) {
  const amount = positiveAmount(bet);
  const reward = positiveAmount(payout);
  if (!duelId || !typePrefix || !amount) throw new Error('INVALID_DUEL_SETTLEMENT');
  if (winnerUserId && reward <= 0) throw new Error('INVALID_DUEL_PAYOUT');
  if (winnerUserId && String(winnerUserId) !== String(challengerId) && String(winnerUserId) !== String(targetUserId)) throw new Error('INVALID_DUEL_WINNER');

  return withRequiredTx(async (session) => {
    const opts = { session };
    const tx = transactionModel.collection();
    const markerId = `__settlement:${String(typePrefix)}:${String(duelId)}`;
    const existing = await tx.findOne({ _id: markerId }, opts);
    if (existing) return { ok: true, duplicate: true, result: existing.result || null, winnerUserId: existing.winnerUserId || null };

    const challenger = extract(await userModel.collection().findOneAndUpdate(
      { userId: { $in: idVariants(challengerId) }, balance: { $gte: amount } },
      { $inc: { balance: -amount, totalLost: amount }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    ));
    if (!challenger) throw new Error('CHALLENGER_INSUFFICIENT');

    const target = extract(await userModel.collection().findOneAndUpdate(
      { userId: { $in: idVariants(targetUserId) }, balance: { $gte: amount } },
      { $inc: { balance: -amount, totalLost: amount }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    ));
    if (!target) throw new Error('TARGET_INSUFFICIENT');

    const added = extract(await treasuryModel.collection().findOneAndUpdate(
      { key: 'treasury' },
      { $inc: { ownerBalance: amount * 2 }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    ));
    if (!added) throw new Error('TREASURY_NOT_FOUND');

    let result = 'TIE';
    let actualWinnerId = null;
    if (winnerUserId) {
      result = String(winnerUserId) === String(challenger.userId) ? 'A' : 'B';
      const winner = extract(await userModel.collection().findOneAndUpdate(
        { userId: { $in: idVariants(winnerUserId) } },
        { $inc: { balance: reward, totalWon: reward }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!winner) throw new Error('WINNER_NOT_FOUND');
      actualWinnerId = winner.userId;

      const paid = extract(await treasuryModel.collection().findOneAndUpdate(
        { key: 'treasury', ownerBalance: { $gte: reward } },
        { $inc: { ownerBalance: -reward }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!paid) throw new Error('TREASURY_INSUFFICIENT');
    } else {
      const reduced = extract(await treasuryModel.collection().findOneAndUpdate(
        { key: 'treasury', ownerBalance: { $gte: amount * 2 } },
        { $inc: { ownerBalance: -amount * 2 }, $set: { updatedAt: new Date() } },
        { session, returnDocument: 'after' }
      ));
      if (!reduced) throw new Error('TREASURY_REFUND_FAILED');

      for (const userId of [challenger.userId, target.userId]) {
        const refunded = extract(await userModel.collection().findOneAndUpdate(
          { userId: { $in: idVariants(userId) } },
          { $inc: { balance: amount }, $set: { updatedAt: new Date() } },
          { session, returnDocument: 'after' }
        ));
        if (!refunded) throw new Error('REFUND_USER_NOT_FOUND');
      }
    }

    await tx.insertOne({
      _id: markerId,
      type: `${String(typePrefix)}_settlement`,
      duelId: String(duelId),
      result,
      payout: reward,
      winnerUserId: actualWinnerId,
      meta: { ...meta, idempotencyKey: markerId },
      createdAt: new Date(),
    }, opts);

    await logTx({
      type: `${String(typePrefix)}_bet`,
      fromUserId: challenger.userId,
      toUserId: 'TREASURY',
      amount,
      meta: { ...meta, duelId: String(duelId), side: 'A', idempotencyKey: `${markerId}:bet:A` },
    }, opts);
    await logTx({
      type: `${String(typePrefix)}_bet`,
      fromUserId: target.userId,
      toUserId: 'TREASURY',
      amount,
      meta: { ...meta, duelId: String(duelId), side: 'B', idempotencyKey: `${markerId}:bet:B` },
    }, opts);

    if (actualWinnerId) {
      await logTx({
        type: `${String(typePrefix)}_win`,
        fromUserId: 'TREASURY',
        toUserId: actualWinnerId,
        amount: reward,
        meta: { ...meta, duelId: String(duelId), idempotencyKey: `${markerId}:win` },
      }, opts);
    } else {
      for (const userId of [challenger.userId, target.userId]) {
        await logTx({
          type: `${String(typePrefix)}_refund`,
          fromUserId: 'TREASURY',
          toUserId: userId,
          amount,
          meta: { ...meta, duelId: String(duelId), idempotencyKey: `${markerId}:refund:${String(userId)}` },
        }, opts);
      }
    }

    return { ok: true, duplicate: false, result, winnerUserId: actualWinnerId };
  });
}

module.exports = {
  ensureUser,
  markStarted,
  getUser,
  getUserByUsername,
  treasuryPayToUser,
  userPayToTreasury,
  transferBalance,
  settleSingleGame,
  settleMultiPayouts,
  settleDuel,
};