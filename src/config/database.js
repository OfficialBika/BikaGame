const { MongoClient } = require('mongodb');
const { env } = require('./env');
const logger = require('../utils/logger');
let client, db;
let TX_SUPPORTED = true;
const collections = {};
async function safeCreateIndex(col, keys, options = {}) {
  try { return await col.createIndex(keys, options); }
  catch (err) {
    if ([85,86].includes(err?.code) || ['IndexOptionsConflict','IndexKeySpecsConflict'].includes(err?.codeName)) {
      logger.warn(`Skipping conflicting index ${col.collectionName} ${JSON.stringify(keys)}`); return null;
    }
    throw err;
  }
}
async function dropLegacyShopCardIdUniqueIndex() {
  try {
    const indexes = await collections.shop_cards.indexes();
    const legacyIndex = indexes.find((idx) => idx?.name === 'cardId_1' && idx?.unique === true && idx?.key?.cardId === 1 && Object.keys(idx?.key || {}).length === 1);
    if (!legacyIndex) return;
    await collections.shop_cards.dropIndex('cardId_1');
    logger.warn('Dropped legacy shop_cards unique index: cardId_1');
  } catch (err) {
    if (err?.codeName === 'IndexNotFound' || err?.code === 27) return;
    logger.warn(`Unable to drop legacy shop_cards cardId_1 index: ${err?.message || err}`);
  }
}
async function safeCreateShopCardsUniqueIndex() {
  try {
    return await safeCreateIndex(collections.shop_cards, { botKey: 1, cardId: 1 }, {
      unique: true,
      name: 'botKey_1_cardId_1',
      partialFilterExpression: { botKey: { $exists: true }, cardId: { $exists: true } },
    });
  } catch (err) {
    if (err?.code === 11000 || err?.codeName === 'DuplicateKey') {
      logger.warn('shop_cards botKey/cardId duplicate data found; bot will continue. Run /fixshopindex to clean duplicates and rebuild the unique index.');
      return null;
    }
    throw err;
  }
}

const TRANSACTION_RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const TRANSACTION_RETENTION_SECONDS = 3 * 24 * 60 * 60;
let retentionCleanupTimer = null;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^$()|[\]\\{}]/g, '\\async function connectMongo() {');
}

async function cleanupExpiredData() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - TRANSACTION_RETENTION_MS);
  const removed = {};

  // Keep active 2D rounds intact. Only remove results whose settlement finished
  // more than 3 days ago; result status is written with the payout transaction.
  const oldTwoD = await collections.two_d_events
    .find({ status: 'result', resultAt: { $lt: cutoff } }, { projection: { eventId: 1 } })
    .toArray();
  const oldTwoDIds = [...new Set(oldTwoD.map((doc) => String(doc.eventId || '')).filter(Boolean))];
  if (oldTwoDIds.length) {
    removed.twoDBets = (await collections.two_d_bets.deleteMany({ eventId: { $in: oldTwoDIds } })).deletedCount;
    removed.twoDPositions = (await collections.two_d_positions.deleteMany({ eventId: { $in: oldTwoDIds } })).deletedCount;
    removed.twoDEvents = (await collections.two_d_events.deleteMany({
      eventId: { $in: oldTwoDIds }, status: 'result', resultAt: { $lt: cutoff },
    })).deletedCount;

    // 2D idempotency keys are temporary; prune only keys that belong to these settled rounds.
    const eventPattern = '^(?:' + oldTwoDIds.map(escapeRegExp).join('|') + '):';
    await collections.users.updateMany(
      { twoDSettlementKeys: { $regex: eventPattern } },
      { $pull: { twoDSettlementKeys: { $regex: eventPattern } } },
    );
    await collections.config.updateOne(
      { key: 'treasury' },
      { $pull: { twoDSettlementKeys: { $in: oldTwoDIds.map((id) => '2d:' + id) } } },
    );
  }

  // Delete only sports events already settled. Never purge open/stopped events or active bets.
  const oldSports = await collections.sports_events
    .find({ status: 'settled', settledAt: { $lt: cutoff } }, { projection: { _id: 1 } })
    .toArray();
  const oldSportsIds = oldSports.map((doc) => doc._id);
  if (oldSportsIds.length) {
    removed.sportsBets = (await collections.sports_bets.deleteMany({ eventId: { $in: oldSportsIds } })).deletedCount;
    removed.sportsEvents = (await collections.sports_events.deleteMany({
      _id: { $in: oldSportsIds }, status: 'settled', settledAt: { $lt: cutoff },
    })).deletedCount;
  }

  // Auctions already closed and past their history expiry are no longer runtime state.
  const expiredAuctions = await collections.auctions
    .find({ status: 'closed', historyExpiresAt: { $lte: now } }, { projection: { auctionId: 1 } })
    .toArray();
  const expiredAuctionIds = [...new Set(expiredAuctions.map((doc) => String(doc.auctionId || '')).filter(Boolean))];
  if (expiredAuctionIds.length) {
    removed.auctionBids = (await collections.auction_bids.deleteMany({ auctionId: { $in: expiredAuctionIds } })).deletedCount;
    removed.auctions = (await collections.auctions.deleteMany({
      auctionId: { $in: expiredAuctionIds }, status: 'closed', historyExpiresAt: { $lte: now },
    })).deletedCount;
  }

  // Order records are retained only while actionable; preserve all pending orders.
  removed.terminalOrders = (await collections.orders.deleteMany({
    createdAt: { $lt: cutoff },
    status: { $in: ['COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED', 'REJECTED', 'DELIVERED'] },
  })).deletedCount;

  // Balance is stored in users/treasury. Keep only the recent transaction ledger and idempotency markers.
  removed.transactions = (await collections.transactions.deleteMany({ createdAt: { $lt: cutoff } })).deletedCount;

  // Retain only short-lived Mini App history and daily tournament rows.
  removed.webGameHistory = (await db.collection('web_game_history').deleteMany({ createdAt: { $lt: cutoff } })).deletedCount;
  const dayParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Yangon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(cutoff);
  const dayPart = (type) => dayParts.find((part) => part.type === type)?.value || '';
  const cutoffDayKey = dayPart('year') + '-' + dayPart('month') + '-' + dayPart('day');
  removed.dailyTournaments = (await db.collection('daily_tournaments').deleteMany({ dayKey: { $lt: cutoffDayKey } })).deletedCount;

  logger.info('3-day retention cleanup completed: ' + JSON.stringify(removed));
}

async function ensureTransactionRetentionIndex() {
  let indexes = [];
  try {
    indexes = await collections.transactions.indexes();
  } catch (err) {
    if (err?.code !== 26 && err?.codeName !== 'NamespaceNotFound') throw err;
  }

  const isCreatedAtOnly = (index) => {
    const keys = Object.keys(index?.key || {});
    return index?.name !== '_id_' && keys.length === 1 && keys[0] === 'createdAt';
  };
  const desired = indexes.find((index) => isCreatedAtOnly(index) &&
    Number(index.expireAfterSeconds) === TRANSACTION_RETENTION_SECONDS);

  // Replace the old createdAt index so a single 3-day TTL index can expire history without
  // keeping duplicate index storage.
  for (const index of indexes) {
    if (isCreatedAtOnly(index) && index.name !== desired?.name) {
      await collections.transactions.dropIndex(index.name);
    }
  }
  if (!desired) {
    await safeCreateIndex(collections.transactions, { createdAt: 1 }, {
      expireAfterSeconds: TRANSACTION_RETENTION_SECONDS,
      name: 'transactions_createdAt_ttl_3d',
    });
  }
}

function startRetentionCleanupSchedule() {
  if (retentionCleanupTimer) return;
  retentionCleanupTimer = setInterval(async () => {
    try {
      await cleanupExpiredData();
      await ensureTransactionRetentionIndex();
    } catch (err) {
      logger.error('3-day retention cleanup failed', err);
    }
  }, 24 * 60 * 60 * 1000);
  if (typeof retentionCleanupTimer.unref === 'function') retentionCleanupTimer.unref();
}

async function connectMongo() {
  client = new MongoClient(env.MONGO_URI, { maxPoolSize: 20, minPoolSize: 1, retryWrites: true });
  await client.connect();
  db = client.db(env.DB_NAME);
  collections.users = db.collection('users');
  collections.transactions = db.collection('transactions');
  collections.orders = db.collection('orders');
  collections.config = db.collection('config');
  collections.groups = db.collection('groups');
  collections.shop_cards = db.collection('shop_cards');
  collections.shop_settings = db.collection('shop_settings');
  collections.two_d_events = db.collection('two_d_events');
  collections.two_d_bets = db.collection('two_d_bets');
  collections.two_d_positions = db.collection('two_d_positions');
  collections.two_d_offdates = db.collection('two_d_offdates');
  collections.treasury = db.collection('treasury');
  collections.sports_events = db.collection('sports_events');
  collections.sports_bets = db.collection('sports_bets');
  collections.auctions = db.collection('auctions');
  collections.auction_bids = db.collection('auction_bids');

  // Free expired history before building indexes; index creation can fail at the free-tier storage cap.
  await cleanupExpiredData();
  try { await ensureTransactionRetentionIndex(); }
  catch (err) { logger.warn('Unable to install 3-day transaction TTL index yet: ' + (err?.message || err)); }

  await safeCreateIndex(collections.users, { userId: 1 }, { unique: true });
  await safeCreateIndex(collections.users, { username: 1 }, { sparse: true });
  await safeCreateIndex(collections.users, { balance: -1 });
  await safeCreateIndex(collections.transactions, { userId: 1, createdAt: -1 });
  await safeCreateIndex(collections.transactions, { type: 1, 'meta.eventId': 1, toUserId: 1 });
  await safeCreateIndex(collections.orders, { status: 1, createdAt: -1 });
  await safeCreateIndex(collections.orders, { userId: 1, createdAt: -1 });
  await safeCreateIndex(collections.orders, { rarity: 1, createdAt: -1 });
  await safeCreateIndex(collections.orders, { cardId: 1 }, { sparse: true });
  await safeCreateIndex(collections.config, { key: 1 }, { unique: true });
  await safeCreateIndex(collections.groups, { groupId: 1 }, { unique: true });
  await safeCreateIndex(collections.groups, { approvalStatus: 1, updatedAt: -1 });
  await dropLegacyShopCardIdUniqueIndex();
  await safeCreateShopCardsUniqueIndex();
  await safeCreateIndex(collections.shop_cards, { cardId: 1 }, { sparse: true, name: 'shop_cards_cardId_lookup' });
  await safeCreateIndex(collections.shop_cards, { rarity: 1, status: 1, cardId: 1 });
  await safeCreateIndex(collections.shop_cards, { status: 1, updatedAt: -1 });
  await safeCreateIndex(collections.shop_cards, { soldToUserId: 1, soldAt: -1 });
  await safeCreateIndex(collections.shop_settings, { key: 1 }, { unique: true });
  await safeCreateIndex(db.collection('sports_events'), { commentChatId: 1, threadRootMessageId: 1, status: 1 });
  await safeCreateIndex(db.collection('sports_events'), { commentChatId: 1, threadMessageIds: 1, status: 1 });
  await safeCreateIndex(db.collection('sports_events'), { status: 1, createdAt: -1 });
  await safeCreateIndex(db.collection('sports_bets'), { eventId: 1, userId: 1 }, { unique: true });
  await safeCreateIndex(db.collection('sports_bets'), { eventId: 1, potentialWin: -1 });
  await safeCreateIndex(db.collection('sports_bets'), { userId: 1, createdAt: -1 });
  await safeCreateIndex(collections.auctions, { auctionId: 1 }, { unique: true, name: 'auctions_id_unique' });
  await safeCreateIndex(collections.auctions, { channelId: 1, status: 1, endAt: 1 }, { name: 'auctions_active_end' });
  await safeCreateIndex(collections.auctions, { channelMessageId: 1 }, { unique: true, sparse: true, name: 'auctions_channel_message_unique' });
  await safeCreateIndex(collections.auction_bids, { auctionId: 1, createdAt: 1 }, { name: 'auction_bids_time' });
  await safeCreateIndex(collections.auction_bids, { auctionId: 1, messageId: 1 }, { unique: true, name: 'auction_bids_message_unique' });
  startRetentionCleanupSchedule();
  logger.info('Mongo connected');
}
function getDb() { if (!db) throw new Error('DB_NOT_CONNECTED'); return db; }
function col(name) { if (!collections[name]) throw new Error(`COLLECTION_NOT_READY:${name}`); return collections[name]; }
async function closeMongo() { if (client) await client.close(); }
function txUnsupported(err) {
  const m = String(err?.message || err);
  return m.includes('Transaction numbers are only allowed') || m.includes('replica set') || m.includes('does not support transactions') || (m.includes('Transaction') && m.includes('not supported'));
}
async function withMaybeTx(work) {
  if (!TX_SUPPORTED) return work(null);
  const session = client.startSession();
  try { return await session.withTransaction(() => work(session)); }
  catch (e) {
    if (txUnsupported(e)) { TX_SUPPORTED = false; logger.warn('Mongo transactions unsupported; fallback mode enabled'); return work(null); }
    throw e;
  } finally { try { await session.endSession(); } catch(_) {} }
}
async function withRequiredTx(work) {
  if (!TX_SUPPORTED) throw new Error('MONGO_TRANSACTIONS_REQUIRED');
  const session = client.startSession();
  try { return await session.withTransaction(() => work(session)); }
  catch (e) {
    if (txUnsupported(e)) {
      TX_SUPPORTED = false;
      logger.error('Mongo transactions are required for this operation; refusing unsafe non-transactional fallback.');
      const err = new Error('MONGO_TRANSACTIONS_REQUIRED');
      err.cause = e;
      throw err;
    }
    throw e;
  } finally { try { await session.endSession(); } catch (_) {} }
}
async function pingMs(){ const s=Date.now(); try{ await getDb().command({ping:1}); return Date.now()-s; }catch(_){return null;} }
module.exports = { connectMongo, closeMongo, getDb, col, withMaybeTx, withRequiredTx, pingMs };