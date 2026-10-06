const userModel = require('../models/userModel');
const treasuryModel = require('../models/treasuryModel');
const { withRequiredTx } = require('../config/database');
const { toNum } = require('../utils/format');
const { logTx } = require('./transactionService');

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

    if (idem && await require('../config/database').getDb().collection('transactions').findOne(txLookup(type, idem), opts)) return { ok: true, duplicate: true };

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

    if (idem && await require('../config/database').getDb().collection('transactions').findOne(txLookup(type, idem), opts)) return { ok: true, duplicate: true };

    const u = extract(await userModel.collection().findOneAndUpdate(
      { userId: { $in: idVariants(fromUserId) }, balance: { $gte: amt } },
      {
        $inc: { balance: -amt, totalLost: String(type).includes('bet') ? amt : 0 },
        $set: { updatedAt: new Date() },
      },
      { session, returnDocument: 'after' }
    ));
    if (!u) throw new Error('USER_INSUFFICIENT');

    const treasury = await treasuryModel.collection().findOneAndUpdate(
      { key: 'treasury' },
      { $inc: { ownerBalance: amt }, $set: { updatedAt: new Date() } },
      { session, returnDocument: 'after' }
    );
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

    if (idem && await require('../config/database').getDb().collection('transactions').findOne(txLookup(type, idem), opts)) return { ok: true, duplicate: true };

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

module.exports = {
  ensureUser,
  markStarted,
  getUser,
  getUserByUsername,
  treasuryPayToUser,
  userPayToTreasury,
  transferBalance,
};