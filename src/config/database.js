const { MongoClient, EJSON } = require('mongodb');
const { env } = require('./env');
const logger = require('../utils/logger');
let client, db;
let TX_SUPPORTED = true;
const collections = {};
let historyClient = null;
let historyDb = null;
let historyReady = false;
let dbOneWriteBlocked = false;
let dbTwoWriteBlocked = false;
let outboxFlushRunning = false;
let outboxFlushTimer = null;
let lastOutboxQuotaLogAt = 0;
let lastHistoryReconnectAttemptAt = 0;
const HISTORY_COLLECTION = 'transactions';

function stableOutboxValue(value) {
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') };
  if (value && typeof value === 'object' && value._bsontype) {
    return { __bsonType: value._bsontype, value: EJSON.stringify(value, { relaxed: false }) };
  }
  if (Array.isArray(value)) return value.map(stableOutboxValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableOutboxValue(value[key])]));
  }
  return value;
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
    // Distinguish the balance cluster from the remote ledger cluster. A DB2
    // quota failure must not falsely mark DB1 writes as blocked; pending DB1
    // outbox entries remain durable until DB2 storage recovers.
    if (isStorageQuotaError(err)) {
      if (col?.s?.db === db) {
        dbOneWriteBlocked = true;
        logger.error(`MongoDB quota blocked DB1 index creation for ${col.collectionName}; financial operations remain blocked until DB1 writes recover.`);
      } else {
        dbTwoWriteBlocked = true;
        logger.error(`MongoDB quota blocked DB2 ledger index creation for ${col.collectionName}; ledger outbox records will be retained for retry.`);
      }
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
  lastHistoryReconnectAttemptAt = Date.now();
  if (!env.DB_TWO_ENABLED) {
    logger.error('DB_TWO_ENABLED must be true. Runtime transaction ledger fallback to DB1 is disabled.');
    return;
  }
  if (!env.MONGO_URI_2 || !env.DB_TWO_NAME) {
    logger.error('DB_TWO_ENABLED is true but MONGO_URI_2/DB_TWO_NAME is missing; financial transactions remain blocked.');
    return;
  }

  // DB1 and DB2 may be separate MongoDB clusters. MongoDB cannot provide a
  // single atomic transaction across them, so balances + an outbox entry commit
  // on DB1; a retryable worker replicates ledger rows to DB2 after that commit.
  historyClient = new MongoClient(env.MONGO_URI_2, { maxPoolSize: 10, minPoolSize: 0, retryWrites: true, readPreference: 'primary' });
  try {
    await historyClient.connect();
    historyDb = historyClient.db(env.DB_TWO_NAME);
    await historyDb.command({ ping: 1 });
    historyReady = true;
    dbTwoWriteBlocked = false;
    logger.info('DB2 ledger connected. DB1 financial changes use a DB1 transaction plus durable outbox; DB2 ledger replication is asynchronous and idempotent.');
  } catch (err) {
    try { await historyClient.close(); } catch (_) {}
    historyClient = null;
    historyDb = null;
    historyReady = false;
    logger.error('DB2 transaction ledger connection failed; financial operations remain blocked until ledger connectivity is restored.', err);
    return;
  }

  await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { type: 1, 'meta.idempotencyKey': 1 }, { name: 'tx_type_idempotency' });
  await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { userId: 1, createdAt: -1 }, { name: 'tx_user_createdAt' });
  await safeCreateIndex(historyDb.collection(HISTORY_COLLECTION), { type: 1, 'meta.eventId': 1, toUserId: 1 }, { name: 'tx_type_event_toUser' });
}

// DB2 remains the ledger/history store; financial mutations write a durable DB1 outbox in the same DB1 transaction.
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

async function flushTransactionHistoryOutbox({ limit = 200 } = {}) {
  if (!env.DB_TWO_ENABLED) return { skipped: true, reason: 'DB_TWO_DISABLED', processed: 0 };
  if (!env.MONGO_URI_2 || !env.DB_TWO_NAME) return { skipped: true, reason: 'DB2_NOT_CONFIGURED', processed: 0 };
  if (dbOneWriteBlocked) return { skipped: true, reason: 'DB1_WRITE_BLOCKED', processed: 0 };
  if (outboxFlushRunning) return { skipped: true, reason: 'already_running', processed: 0 };

  outboxFlushRunning = true;
  const outbox = collections.transaction_outbox || db.collection('transaction_outbox');
  try {
    if (!historyReady || !historyDb) {
      // Retry a failed startup/connection at a bounded cadence. DB1 financial
      // commits remain safe while the ledger cluster is temporarily unavailable.
      if (Date.now() - lastHistoryReconnectAttemptAt < 30_000) {
        return { skipped: true, reason: 'DB2_RECONNECT_BACKOFF', processed: 0 };
      }
      await connectTransactionHistory();
      if (!historyReady || !historyDb) {
        return { skipped: true, reason: 'DB2_NOT_READY', processed: 0 };
      }
    }

    const rows = await outbox.find({ status: 'pending' })
      .sort({ createdAt: 1, _id: 1 })
      .limit(Math.max(1, Math.min(1000, Number(limit) || 200)))
      .toArray();
    if (!rows.length) {
      dbTwoWriteBlocked = false;
      return { processed: 0, pending: 0 };
    }

    const validRows = [];
    const malformedIds = [];
    for (const row of rows) {
      const payload = row?.payload;
      const targetId = row?.targetId ?? payload?._id ?? row?.sourceId;
      if (!payload || typeof payload !== 'object' || targetId == null ||
          (payload._id != null && String(payload._id) !== String(targetId))) {
        malformedIds.push(row._id);
      } else {
        validRows.push({ row, targetId, payload: { ...payload, _id: targetId } });
      }
    }

    if (malformedIds.length) {
      await outbox.updateMany(
        { _id: { $in: malformedIds }, status: 'pending' },
        { $set: { status: 'failed', lastError: 'INVALID_OUTBOX_PAYLOAD', updatedAt: new Date() } },
      );
      logger.error('Marked ' + malformedIds.length + ' malformed transaction outbox row(s) as failed; rows were preserved for inspection.');
    }
    if (!validRows.length) return { processed: 0, failed: malformedIds.length, pending: await outbox.countDocuments({ status: 'pending' }) };

    // $setOnInsert makes replay safe if DB2 accepted a previous attempt but the
    // acknowledgement or DB1 outbox deletion was interrupted.
    const ledger = historyDb.collection(HISTORY_COLLECTION);
    await ledger.bulkWrite(
      validRows.map(({ targetId, payload }) => ({
        updateOne: {
          filter: { _id: targetId },
          update: { $setOnInsert: payload },
          upsert: true,
        },
      })),
      { ordered: true },
    );

    // Verify the persisted DB2 documents before acknowledging/removing any outbox
    // rows. In particular, never silently discard a payload if DB2 already has
    // the same _id but different values from an earlier partial migration.
    const targetIds = validRows.map(({ targetId }) => targetId);
    const storedRows = await ledger.find({ _id: { $in: targetIds } }).toArray();
    const storedById = new Map(storedRows.map((doc) => [String(doc._id), doc]));
    const verifiedRows = [];
    const mismatchedRows = [];
    for (const entry of validRows) {
      const stored = storedById.get(String(entry.targetId));
      if (!stored) throw new Error('DB2_OUTBOX_TARGET_MISSING_AFTER_UPSERT');
      if (JSON.stringify(stableOutboxValue(stored)) !== JSON.stringify(stableOutboxValue(entry.payload))) {
        mismatchedRows.push(entry);
      } else {
        verifiedRows.push(entry);
      }
    }

    // A legacy row whose _id already exists with different contents must never
    // block every later queue item. Quarantine its source payload for inspection,
    // while keeping it in DB1 instead of overwriting or deleting it.
    if (mismatchedRows.length) {
      await outbox.updateMany(
        { _id: { $in: mismatchedRows.map(({ row }) => row._id) }, status: 'pending' },
        { $set: { status: 'failed', lastError: 'DB2_OUTBOX_TARGET_MISMATCH', failedAt: new Date(), updatedAt: new Date() } },
      );
      logger.error('Quarantined ' + mismatchedRows.length + ' transaction outbox row(s) because DB2 already contains a different document with the same _id; source payloads were preserved.');
    }

    const removed = verifiedRows.length
      ? await outbox.deleteMany({ _id: { $in: verifiedRows.map(({ row }) => row._id) } })
      : { deletedCount: 0 };
    dbTwoWriteBlocked = false;
    return {
      processed: verifiedRows.length,
      removed: Number(removed.deletedCount || 0),
      failed: malformedIds.length + mismatchedRows.length,
      pending: await outbox.countDocuments({ status: 'pending' }),
    };
  } catch (err) {
    if (isStorageQuotaError(err)) {
      dbTwoWriteBlocked = true;
      const now = Date.now();
      if (now - lastOutboxQuotaLogAt >= 60_000) {
        lastOutboxQuotaLogAt = now;
        logger.error('DB2 ledger writes are blocked by its storage quota; DB1 outbox entries remain stored and will be retried after DB2 storage recovers.', err);
      }
    }
    throw err;
  } finally {
    outboxFlushRunning = false;
  }
}

function startTransactionHistoryOutbox() {
  if (outboxFlushTimer) return;
  const run = () => flushTransactionHistoryOutbox().catch((err) => {
    if (!isStorageQuotaError(err)) logger.error('DB2 transaction outbox flush failed; entries were retained for retry.', err);
  });
  run();
  outboxFlushTimer = setInterval(run, 15_000);
  outboxFlushTimer.unref?.();
}

async function stopTransactionHistoryOutbox() {
  if (outboxFlushTimer) clearInterval(outboxFlushTimer);
  outboxFlushTimer = null;
}

async function findTransactionHistoryByIdempotency(type, key, session) {
  if (!key) return null;
  if (!env.DB_TWO_ENABLED) throw new Error('DB_TWO_DISABLED');
  if (!db) throw new Error('DB_NOT_CONNECTED');
  // Include a request-specific idempotency key: multiple independent transfers
  // may legitimately share a type and must not collide.
  const id = String(type) + ':' + String(key);
  const options = session ? { session } : {};
  return db.collection('financial_idempotency').findOne({ _id: id }, options);
}

async function reserveTransactionIdempotency(type, key, session, options = {}) {
  if (key == null || String(key) === '') return null;
  if (!db) throw new Error('DB_NOT_CONNECTED');
  const id = String(type) + ':' + String(key);
  const createdAt = new Date();
  return db.collection('financial_idempotency').insertOne({
    _id: id,
    type: String(type),
    key: String(key),
    createdAt,
    ...options,
  }, session ? { session } : {});
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
    mode: 'db1-transactional-outbox-db2-ledger',
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
  collections.transaction_outbox = db.collection('transaction_outbox');
  collections.financial_idempotency = db.collection('financial_idempotency');
  collections.financial_settlements = db.collection('financial_settlements');
  // Telegram payment charge IDs are permanent idempotency keys and must not expire with game-history markers.
  collections.stars_payment_idempotency = db.collection('stars_payment_idempotency');

  await connectTransactionHistory();
  collections.transactions = historyReady && historyDb ? historyDb.collection(HISTORY_COLLECTION) : null;

  await safeCreateIndex(collections.transaction_outbox, { status: 1, createdAt: 1 }, { name: 'transaction_outbox_pending_createdAt' });
  await safeCreateIndex(collections.financial_idempotency, { createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60, name: 'ttl_financial_idempotency_7d' });
  await safeCreateIndex(collections.financial_settlements, { createdAt: 1 }, { expireAfterSeconds: 7 * 24 * 60 * 60, name: 'ttl_financial_settlements_7d' });
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
function isHistoryConfigured() { return Boolean(env.DB_TWO_ENABLED && env.MONGO_URI_2 && env.DB_TWO_NAME); }
function isHistoryReady() { return Boolean(isHistoryConfigured() && historyReady && historyDb); }
function isDbOneWriteBlocked() { return dbOneWriteBlocked; }
function markDbOneWriteBlocked() { dbOneWriteBlocked = true; }
async function closeMongo() { if (historyClient && historyClient !== client) await historyClient.close().catch(() => {}); if (client) await client.close().catch(() => {}); }
function txUnsupported(err) {
  const m = String(err?.message || err);
  return m.includes('Transaction numbers are only allowed') || m.includes('replica set') || m.includes('does not support transactions') || (m.includes('Transaction') && m.includes('not supported'));
}
async function withMaybeTx(work) {
  if (!isHistoryConfigured()) throw new Error('DB_TWO_HISTORY_NOT_CONFIGURED');
  if (dbOneWriteBlocked) throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
  if (!TX_SUPPORTED) throw new Error('MONGO_TRANSACTIONS_REQUIRED');
  const session = client.startSession();
  try { return await session.withTransaction(() => work(session)); }
  catch (e) {
    if (txUnsupported(e)) {
      TX_SUPPORTED = false;
      logger.error('Mongo transactions are required to atomically commit DB1 balances, settlement markers, and the durable ledger outbox; unsafe fallback is disabled.');
      const err = new Error('MONGO_TRANSACTIONS_REQUIRED');
      err.cause = e;
      throw err;
    }
    throw e;
  } finally { try { await session.endSession(); } catch(_) {} }
}
async function withRequiredTx(work) {
  if (!isHistoryConfigured()) throw new Error('DB_TWO_HISTORY_NOT_CONFIGURED');
  if (dbOneWriteBlocked) throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
  if (!TX_SUPPORTED) throw new Error('MONGO_TRANSACTIONS_REQUIRED');
  const session = client.startSession();
  try { return await session.withTransaction(() => work(session)); }
  catch (e) {
    if (txUnsupported(e)) {
      TX_SUPPORTED = false;
      logger.error('Mongo transactions are required to atomically commit DB1 balances, settlement markers, and durable outbox entries; refusing unsafe fallback.');
      const err = new Error('MONGO_TRANSACTIONS_REQUIRED');
      err.cause = e;
      throw err;
    }
    throw e;
  } finally { try { await session.endSession(); } catch (_) {} }
}
async function pingMs(){ const s=Date.now(); try{ await getDb().command({ping:1}); return Date.now()-s; }catch(_){return null;} }
module.exports = { startTransactionHistoryOutbox, stopTransactionHistoryOutbox, reserveTransactionIdempotency, isHistoryConfigured, connectMongo, closeMongo, getDb, col, safeCreateIndex, withMaybeTx, withRequiredTx, pingMs, enqueueTransactionHistory, flushTransactionHistoryOutbox, findTransactionHistoryByIdempotency, getTransactionHistoryDb, getTransactionHistoryCollection, getTransactionHistoryStats, initializeTransactionHistoryStorage, hasVerifiedInitialMigration, copyVerifiedHistoryDocument, migrateTransactionHistory, verifyRetainedTransactionHistory, isHistoryReady, isDbOneWriteBlocked, markDbOneWriteBlocked };