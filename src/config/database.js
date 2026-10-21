const { MongoClient } = require('mongodb');
const { env } = require('./env');
const logger = require('../utils/logger');
let client, db;
let TX_SUPPORTED = true;
const collections = {};
let historyClient = null;
let historyDb = null;
let historyReady = false;
let transactionsShareClient = false;
let dbOneWriteBlocked = false;
const HISTORY_COLLECTION = 'transactions';

function sameMongoDeployment(left, right) {
  try {
    const a = new URL(left);
    const b = new URL(right);
    const authA = [decodeURIComponent(a.username), decodeURIComponent(a.password)];
    const authB = [decodeURIComponent(b.username), decodeURIComponent(b.password)];
    const optionA = (key) => a.searchParams.get(key) || '';
    const optionB = (key) => b.searchParams.get(key) || '';
    return a.protocol === b.protocol &&
      a.host.toLowerCase() === b.host.toLowerCase() &&
      authA[0] === authB[0] &&
      authA[1] === authB[1] &&
      optionA('authSource') === optionB('authSource') &&
      optionA('replicaSet') === optionB('replicaSet');
  } catch (_) {
    return left === right;
  }
}

function isStorageQuotaError(err) {
  return err?.code === 8000 ||
    err?.codeName === 'AtlasError' ||
    /over your space quota|writes are blocked on your cluster/i.test(String(err?.message || err));
}

async function safeCreateIndex(col, keys, options = {}) {
  try { return await col.createIndex(keys, options); }
  catch (err) {
    if ([85,86].includes(err?.code) || ['IndexOptionsConflict','IndexKeySpecsConflict'].includes(err?.codeName)) {
      logger.warn(`Skipping conflicting index ${col.collectionName} ${JSON.stringify(keys)}`); return null;
    }
    // Index creation is optional bootstrap metadata. A quota error blocks financial
    // writes because either the ledger or the balance store may be unavailable.
    if (isStorageQuotaError(err)) {
      dbOneWriteBlocked = true;
      logger.error(`MongoDB quota blocked index creation for ${col.collectionName}; continuing diagnostic startup without index ${JSON.stringify(keys)}. Financial operations remain blocked until storage writes recover.`);
      return null;
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


async function connectTransactionHistory() {
  if (!env.DB_TWO_ENABLED) {
    logger.error('DB_TWO_ENABLED must be true. Runtime transaction ledger fallback to DB1 is disabled.');
    return;
  }
  if (!env.MONGO_URI_2 || !env.DB_TWO_NAME) {
    logger.error('DB_TWO_ENABLED is true but MONGO_URI_2/DB_TWO_NAME is missing; financial transactions remain blocked.');
    return;
  }

  // The DB1 balance/treasury updates and DB2 ledger rows must participate in the
  // same MongoDB session. When both URIs identify the same deployment and auth
  // identity (the database path may differ), reuse the primary client. Never pass
  // a DB1 session to a different MongoClient.
  if (sameMongoDeployment(env.MONGO_URI_2, env.MONGO_URI)) {
    historyClient = client;
    historyDb = client.db(env.DB_TWO_NAME);
    try {
      await historyDb.command({ ping: 1 });
      historyReady = true;
      transactionsShareClient = true;
      logger.info('DB2 transaction ledger connected on shared MongoClient; DB1 transactions collection will not be used.');
    } catch (err) {
      historyDb = null;
      historyReady = false;
      transactionsShareClient = false;
      logger.error('DB2 transaction ledger connection failed; financial operations remain blocked.', err);
      return;
    }
  } else {
    historyClient = new MongoClient(env.MONGO_URI_2, { maxPoolSize: 10, minPoolSize: 0, retryWrites: true });
    try {
      await historyClient.connect();
      historyDb = historyClient.db(env.DB_TWO_NAME);
      await historyDb.command({ ping: 1 });
      historyReady = true;
      transactionsShareClient = false;
      logger.error('DB2 ledger is reachable, but MONGO_URI_2 differs from MONGO_URI. Financial operations are blocked because cross-client transactions are not atomic.');
    } catch (err) {
      try { await historyClient.close(); } catch (_) {}
      historyClient = null;
      historyDb = null;
      historyReady = false;
      transactionsShareClient = false;
      logger.error('DB2 transaction ledger connection failed; financial operations remain blocked.', err);
    }
  }

  if (historyReady) {
    await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { type: 1, 'meta.idempotencyKey': 1 }, { name: 'tx_type_idempotency' });
    await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { userId: 1, createdAt: -1 }, { name: 'tx_user_createdAt' });
    await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { type: 1, 'meta.eventId': 1, toUserId: 1 }, { name: 'tx_type_event_toUser' });
  }
}

// DB2 is the only transaction ledger. No runtime transaction outbox is written to DB1.
async function enqueueTransactionHistory() {
  return null;
}

async function initializeTransactionHistoryStorage() {
  if (!env.DB_TWO_ENABLED || !historyReady) return { skipped: true };
  // Explicit caller can choose the DB2 bootstrap step. Normal bot startup does
  // not run bulk migration and never deletes the source ledger.
  await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { createdAt: -1 }, { name: 'tx_history_createdAt_desc' });
  await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { userId: 1, createdAt: -1 }, { name: 'tx_history_user_createdAt' });
  await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { type: 1, 'meta.eventId': 1, toUserId: 1 }, { name: 'tx_history_type_event_toUser' });
  return { ready: true };
}

async function flushTransactionHistoryOutbox() {
  return { skipped: true, processed: 0, reason: 'DB2_IS_AUTHORITATIVE_LEDGER' };
}

async function findTransactionHistoryByIdempotency(type, key, session) {
  if (!key) return null;
  if (!env.DB_TWO_ENABLED || !historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  if (session && !transactionsShareClient) throw new Error('DB_TWO_MUST_SHARE_MONGO_CLIENT_FOR_ATOMIC_TRANSACTIONS');
  return historyDb.collection(HISTORY_COLLECTION).findOne(
    { type, 'meta.idempotencyKey': key },
    session ? { session } : {},
  );
}

async function recordTransactionMigrationReport() {
  throw new Error('DB2_IS_AUTHORITATIVE_LEDGER; DB1_TRANSACTION_MIGRATION_IS_DISABLED');
}

async function getTransactionHistoryStats() {
  if (!env.DB_TWO_ENABLED || !historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const transactions = historyDb.collection(HISTORY_COLLECTION);
  const [count, stats] = await Promise.all([
    transactions.countDocuments({}),
    transactions.stats().catch(() => null),
  ]);
  return {
    mode: 'db2-authoritative',
    legacyDb1TransactionsRead: false,
    source: null,
    target: { count, storageSize: stats?.storageSize ?? null, totalIndexSize: stats?.totalIndexSize ?? null },
  };
}

async function hasVerifiedInitialMigration() {
  // Runtime no longer gates transactions on the old DB1-to-DB2 mirror migration.
  return Boolean(env.DB_TWO_ENABLED && historyReady && historyDb);
}

async function verifyRetainedTransactionHistory() {
  throw new Error('DB2_IS_AUTHORITATIVE_LEDGER; DB1_TRANSACTION_VERIFICATION_IS_DISABLED');
}

async function migrateTransactionHistory() {
  throw new Error('DB2_IS_AUTHORITATIVE_LEDGER; DB1_TRANSACTION_MIGRATION_IS_DISABLED');
}

async function copyVerifiedHistoryDocument() {
  throw new Error('DB2_IS_AUTHORITATIVE_LEDGER; DB1_HISTORY_COPY_IS_DISABLED');
}

async function getTransactionHistoryCollection() {
  if (!env.DB_TWO_ENABLED || !historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  return historyDb.collection(HISTORY_COLLECTION);
}

async function getTransactionHistoryDb() {
  if (!env.DB_TWO_ENABLED || !historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  return historyDb;
}

function startTransactionHistoryOutbox() {
  // Deprecated: DB2 is authoritative; no DB1 outbox is used.
}
async function stopTransactionHistoryOutbox() {
  // Deprecated: there is no runtime outbox to flush.
}

async function connectMongo() {
  client = new MongoClient(env.MONGO_URI, { maxPoolSize: 20, minPoolSize: 1, retryWrites: true });
  try {
    await client.connect();
    db = client.db(env.DB_NAME);
    // Check whether DB1 can still accept writes (balances/treasury live here).
    // A quota error puts financial operations into recovery-only mode.
    try {
      await db.collection('__bika_db1_write_probe').insertOne(
        { _id: 'probe', createdAt: new Date() },
        { writeConcern: { w: 1, wtimeoutMS: 3000 } },
      );
      try {
        await db.collection('__bika_db1_write_probe').deleteOne({ _id: 'probe' });
        await db.collection('__bika_db1_write_probe').drop();
      } catch (cleanupErr) {
        logger.warn('DB1 startup probe cleanup failed.', cleanupErr);
      }
    } catch (probeErr) {
      if (isStorageQuotaError(probeErr)) {
        dbOneWriteBlocked = true;
        logger.error('DB1 storage quota is blocking writes; starting in recovery-only mode. Financial transactions remain blocked.');
      } else {
        logger.warn('DB1 write probe could not finish; index bootstrap and guarded runtime writes will provide additional diagnostics.', probeErr);
      }
    }
  } catch (err) {
    try { await client.close(); } catch (_) {}
    client = null;
    throw err;
  }

  collections.users = db.collection('users');
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
  collections.daily_tournaments = db.collection('daily_tournaments');

  await connectTransactionHistory();
  collections.transactions = historyReady && historyDb ? historyDb.collection(HISTORY_COLLECTION) : null;

  await safeCreateIndex(collections.users, { userId: 1 }, { unique: true });
  await safeCreateIndex(collections.users, { username: 1 }, { sparse: true });
  await safeCreateIndex(collections.users, { balance: -1 });
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
  logger.info('Mongo connected');
}


function getDb() { if (!db) throw new Error('DB_NOT_CONNECTED'); return db; }
function col(name) { if (name === 'transactions') { if (!env.DB_TWO_ENABLED || !historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY'); return historyDb.collection(HISTORY_COLLECTION); } if (!collections[name]) throw new Error(`COLLECTION_NOT_READY:${name}`); return collections[name]; }
function isHistoryReady() { return Boolean(env.DB_TWO_ENABLED && historyReady && historyDb); }
function isDbOneWriteBlocked() { return dbOneWriteBlocked; }
function markDbOneWriteBlocked() { dbOneWriteBlocked = true; }
async function closeMongo() { if (historyClient && historyClient !== client) await historyClient.close().catch(() => {}); if (client) await client.close().catch(() => {}); }
function txUnsupported(err) {
  const m = String(err?.message || err);
  return m.includes('Transaction numbers are only allowed') || m.includes('replica set') || m.includes('does not support transactions') || (m.includes('Transaction') && m.includes('not supported'));
}
async function withMaybeTx(work) {
  if (!env.DB_TWO_ENABLED || !historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  if (!transactionsShareClient) throw new Error('DB_TWO_MUST_SHARE_MONGO_CLIENT_FOR_ATOMIC_TRANSACTIONS');
  if (dbOneWriteBlocked) throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
  if (!TX_SUPPORTED) throw new Error('MONGO_TRANSACTIONS_REQUIRED');
  const session = client.startSession();
  try { return await session.withTransaction(() => work(session)); }
  catch (e) {
    if (txUnsupported(e)) {
      TX_SUPPORTED = false;
      logger.error('Mongo transactions are required for DB1 balance + DB2 ledger atomicity; unsafe fallback is disabled.');
      const err = new Error('MONGO_TRANSACTIONS_REQUIRED');
      err.cause = e;
      throw err;
    }
    throw e;
  } finally { try { await session.endSession(); } catch(_) {} }
}
async function withRequiredTx(work) {
  if (!env.DB_TWO_ENABLED || !historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  if (!transactionsShareClient) throw new Error('DB_TWO_MUST_SHARE_MONGO_CLIENT_FOR_ATOMIC_TRANSACTIONS');
  if (dbOneWriteBlocked) throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
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
module.exports = { connectMongo, closeMongo, getDb, col, safeCreateIndex, withMaybeTx, withRequiredTx, pingMs, enqueueTransactionHistory, flushTransactionHistoryOutbox, findTransactionHistoryByIdempotency, getTransactionHistoryDb, getTransactionHistoryCollection, getTransactionHistoryStats, initializeTransactionHistoryStorage, hasVerifiedInitialMigration, copyVerifiedHistoryDocument, migrateTransactionHistory, verifyRetainedTransactionHistory, isHistoryReady, isDbOneWriteBlocked, markDbOneWriteBlocked };