const { ObjectId } = require('mongodb');
const { fmt, toNum } = require('../utils/format');

let users;

function init({ users: usersCollection }) {
  users = usersCollection;
}

/**
 * Ensure a user document exists in the database. If the user does not exist,
 * create one with a starting balance.
 * @param {Object} tgUser Telegram user object
 * @param {Number} startBonus Amount to credit to new users
 */
async function ensureUser(tgUser, startBonus = 0) {
  if (!users) throw new Error('UserService not initialized');
  const now = new Date();
  const existing = await users.findOne({ userId: tgUser.id });
  if (existing) return existing;
  const doc = {
    userId: tgUser.id,
    username: tgUser.username ? tgUser.username.toLowerCase() : null,
    firstName: tgUser.first_name || null,
    lastName: tgUser.last_name || null,
    balance: startBonus,
    lastDailyClaim: null,
    createdAt: now,
    updatedAt: now,
  };
  await users.insertOne(doc);
  return doc;
}

async function getUserById(userId) {
  return users.findOne({ userId });
}

async function getUserByUsername(username) {
  if (!username) return null;
  return users.findOne({ username: username.toLowerCase() });
}

async function addBalance(userId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const res = await users.findOneAndUpdate(
    { userId },
    { $inc: { balance: amount }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return res.value;
}

async function subtractBalance(userId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const user = await users.findOne({ userId });
  if (!user || toNum(user.balance) < amount) return null;
  const res = await users.findOneAndUpdate(
    { userId },
    { $inc: { balance: -amount }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return res.value;
}

async function transferBalance(fromUserId, toUserId, amount) {
  if (fromUserId === toUserId) return { ok: false, msg: 'Cannot transfer to yourself.' };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, msg: 'Invalid amount.' };
  const fromUser = await users.findOne({ userId: fromUserId });
  const toUser = await users.findOne({ userId: toUserId });
  if (!toUser) return { ok: false, msg: 'Recipient not found.' };
  if (!fromUser || toNum(fromUser.balance) < amount) return { ok: false, msg: 'Insufficient funds.' };
  // Deduct from sender
  await users.updateOne({ userId: fromUserId }, { $inc: { balance: -amount }, $set: { updatedAt: new Date() } });
  // Add to recipient
  await users.updateOne({ userId: toUserId }, { $inc: { balance: amount }, $set: { updatedAt: new Date() } });
  return { ok: true };
}

async function dailyClaim(userId, minReward, maxReward, tz) {
  const user = await users.findOne({ userId });
  if (!user) return { ok: false, msg: 'User not found.' };
  const now = new Date();
  const currentDayKey = now.toLocaleDateString('en-US', { timeZone: tz });
  const lastDayKey = user.lastDailyClaim ? new Date(user.lastDailyClaim).toLocaleDateString('en-US', { timeZone: tz }) : null;
  if (currentDayKey === lastDayKey) {
    return { ok: false, msg: 'Already claimed today.' };
  }
  const amount = Math.floor(Math.random() * (maxReward - minReward + 1)) + minReward;
  await users.updateOne(
    { userId },
    { $inc: { balance: amount }, $set: { lastDailyClaim: now, updatedAt: now } }
  );
  return { ok: true, amount };
}

async function topUsers(limit = 10) {
  const cur = users
    .find({}, { projection: { userId: 1, username: 1, firstName: 1, lastName: 1, balance: 1 } })
    .sort({ balance: -1 })
    .limit(limit);
  return cur.toArray();
}

module.exports = {
  init,
  ensureUser,
  getUserById,
  getUserByUsername,
  addBalance,
  subtractBalance,
  transferBalance,
  dailyClaim,
  topUsers,
};