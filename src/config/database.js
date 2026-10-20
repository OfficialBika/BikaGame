const { MongoClient } = require('mongodb');

const { AsyncLocalStorage } = require('async_hooks');
const crypto = require('crypto');
const { env } = require('./env');
const logger = require('../utils/logger');
let client, db;
let TX_SUPPORTED = true;
const collections = {};
const transactionContext = new AsyncLocalStorage();
const TX_JOURNAL_COLLECTION = '_transaction_journal';
const TX_RESERVATIONS_COLLECTION = '_transaction_key_reservations';
const RECONCILIATION_GRACE_MS = 120000;
let historyClient = null;
let historyDb = null;
let historyReady = false;
let dbOneWriteBlocked = false;
const HISTORY_COLLECTION = 'transactions';

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
    // Index creation is optional bootstrap metadata, but a quota error proves DB1
    // cannot currently accept writes. Keep startup possible for diagnostics only.
    if (isStorageQuotaError(err)) {
      dbOneWriteBlocked = true;
      logger.error(`MongoDB quota blocked index creation for ${col.collectionName}; continuing diagnostic startup without index ${JSON.stringify(keys)}. Money operations remain blocked until DB1 writes recover.`);
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
    throw new Error('DB_TWO_ENABLED_REQUIRED: DB2 is the only transaction ledger; set DB_TWO_ENABLED=true.');
  }
  if (!env.MONGO_URI_2 || !env.DB_TWO_NAME) {
    throw new Error('DB_TWO_CONFIG_REQUIRED: set MONGO_URI_2 and DB_TWO_NAME before startup.');
  }

  historyClient = new MongoClient(env.MONGO_URI_2, { maxPoolSize: 20, minPoolSize: 0, retryWrites: true });
  try {
    await historyClient.connect();
    historyDb = historyClient.db(env.DB_TWO_NAME);
    await historyDb.command({ ping: 1 });
    await historyDb.collection(HISTORY_COLLECTION).createIndex({ createdAt: -1 }, { name: 'tx_history_createdAt_desc' });
    await historyDb.collection(HISTORY_COLLECTION).createIndex({ userId: 1, createdAt: -1 }, { name: 'tx_history_user_createdAt' });
    await historyDb.collection(HISTORY_COLLECTION).createIndex({ type: 1, 'meta.eventId': 1, toUserId: 1 }, { name: 'tx_history_type_event_toUser' });
    await historyDb.collection(HISTORY_COLLECTION).createIndex({ type: 1, 'meta.idempotencyKey': 1 }, { name: 'tx_history_type_idempotency' });
    await historyDb.collection(TX_JOURNAL_COLLECTION).createIndex({ status: 1, createdAt: 1 }, { name: 'tx_journal_status_createdAt' });
    await historyDb.collection(TX_RESERVATIONS_COLLECTION).createIndex({ operationId: 1 }, { name: 'tx_reservations_operationId' });
    historyReady = true;
    logger.info('DB2-only transaction ledger connected; DB1 transactions/outbox are not used by runtime.');
  } catch (err) {
    try { if (historyClient) await historyClient.close(); } catch (_) {}
    historyClient = null;
    historyDb = null;
    historyReady = false;
    throw new Error('DB2_TRANSACTION_LEDGER_UNAVAILABLE: refusing startup instead of falling back to DB1 transaction history', { cause: err });
  }
}

async function initializeTransactionHistoryStorage() {
  if (!historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
  await historyDb.collection(HISTORY_COLLECTION).createIndex({ createdAt: -1 }, { name: 'tx_history_createdAt_desc' });
  await historyDb.collection(HISTORY_COLLECTION).createIndex({ userId: 1, createdAt: -1 }, { name: 'tx_history_user_createdAt' });
  await historyDb.collection(HISTORY_COLLECTION).createIndex({ type: 1, 'meta.eventId': 1, toUserId: 1 }, { name: 'tx_history_type_event_toUser' });
  await historyDb.collection(HISTORY_COLLECTION).createIndex({ type: 1, 'meta.idempotencyKey': 1 }, { name: 'tx_history_type_idempotency' });
  return { ready: true, database: 'DB2', collection: HISTORY_COLLECTION };
}

function getTransactionHistoryCollection() {
  if (!historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  return transactionLedgerFacade();
}

async function getTransactionHistoryDb() {
  if (!historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  return historyDb;
}

async function getTransactionHistoryStats() {
  if (!historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const ledger = historyDb.collection(HISTORY_COLLECTION);
  const journal = historyDb.collection(TX_JOURNAL_COLLECTION);
  const reservations = historyDb.collection(TX_RESERVATIONS_COLLECTION);
  const [count, stats, prepared, reconciliationRequired, reservationCount] = await Promise.all([
    ledger.countDocuments({}),
    ledger.stats().catch(() => null),
    journal.countDocuments({ status: 'prepared' }),
    journal.countDocuments({ status: 'reconciliation_required' }),
    reservations.countDocuments({}),
  ]);
  return {
    authoritativeDatabase: 'DB2',
    collection: HISTORY_COLLECTION,
    count,
    storageSize: stats?.storageSize ?? null,
    totalIndexSize: stats?.totalIndexSize ?? null,
    journal: { prepared, reconciliationRequired, reservations: reservationCount },
  };
}

async function hasVerifiedInitialMigration() {
  if (!historyReady || !historyDb) return false;
  const report = await historyDb.collection('_migration_reports').findOne({
    _id: 'initial-transactions-migration-v1',
    verified: true,
    status: 'verified',
  });
  return !!report;
}

async function getUnresolvedTransactionJournals(limit = 10) {
  if (!historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const cutoff = new Date(Date.now() - RECONCILIATION_GRACE_MS);
  return historyDb.collection(TX_JOURNAL_COLLECTION)
    .find({
      $or: [
        { status: 'reconciliation_required' },
        { status: 'prepared', createdAt: { $lte: cutoff } },
      ],
    }, { projection: { _id: 1, status: 1, createdAt: 1, entryCount: 1, error: 1 } })
    .sort({ createdAt: 1 })
    .limit(Math.max(1, Math.min(100, Number(limit) || 10)))
    .toArray();
}

function withoutClientSession(options) {
  if (!options || typeof options !== 'object' || !Object.prototype.hasOwnProperty.call(options, 'session')) return options;
  const { session, ...safeOptions } = options;
  return safeOptions;
}

function ledgerStableValue(value) {
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') };
  if (value && value._bsontype === 'ObjectId' && typeof value.toHexString === 'function') {
    return { __objectId: value.toHexString() };
  }
  if (value && value._bsontype && typeof value.toString === 'function') {
    return { __bsonType: value._bsontype, value: value.toString() };
  }
  if (Array.isArray(value)) return value.map(ledgerStableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ledgerStableValue(value[key])]));
  }
  return value;
}

async function reserveTransactionKey(context, key, kind) {
  const reservationId = crypto.createHash('sha256').update(String(kind) + '\0' + String(key)).digest('hex');
  const reservations = historyDb.collection(TX_RESERVATIONS_COLLECTION);
  try {
    await reservations.insertOne({
      _id: reservationId,
      key: String(key),
      kind: String(kind),
      operationId: context.operationId,
      status: 'reserved',
      createdAt: context.startedAt,
    });
  } catch (err) {
    if (err?.code !== 11000 && err?.codeName !== 'DuplicateKey') throw err;
    const existing = await reservations.findOne({ _id: reservationId });
    if (!existing || String(existing.operationId) !== String(context.operationId)) {
      throw new Error('DB2_IDEMPOTENCY_IN_PROGRESS: another operation holds the same transaction key');
    }
  }
  if (!context.reservationIds.includes(reservationId)) context.reservationIds.push(reservationId);
  return reservationId;
}

function queueTransactionRecord(document) {
  const context = transactionContext.getStore();
  if (!context) {
    throw new Error('DB2_LEDGER_WRITE_REQUIRES_WITH_REQUIRED_TX');
  }
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('INVALID_TRANSACTION_LEDGER_DOCUMENT');
  }
  const entry = { ...document };
  if (entry._id == null) entry._id = 'tx:' + context.operationId + ':' + String(context.entries.length + 1);
  if (context.entries.some((item) => String(item._id) === String(entry._id))) {
    throw new Error('DB2_LEDGER_DUPLICATE_ENTRY_ID');
  }
  context.entries.push(entry);
  return Promise.resolve({ acknowledged: true, insertedId: entry._id, queuedForCommit: true });
}

function transactionLedgerFacade() {
  if (!historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const raw = historyDb.collection(HISTORY_COLLECTION);
  const mutatingMethods = new Set([
    'insertMany', 'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
    'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete', 'bulkWrite',
    'drop', 'dropIndex', 'dropIndexes', 'rename', 'createIndex',
  ]);
  return new Proxy(raw, {
    get(target, property) {
      if (property === 'insertOne') return (document) => queueTransactionRecord(document);
      if (property === 'findOne') return async (filter = {}, options = {}) => {
        const safeOptions = withoutClientSession(options);
        const existing = await target.findOne(filter, safeOptions);
        if (existing) return existing;
        const context = transactionContext.getStore();
        const markerId = filter && typeof filter._id === 'string' && Object.keys(filter).length === 1
          ? filter._id
          : null;
        if (context && markerId && (markerId.startsWith('__settlement:') || markerId.startsWith('__stars_purchase:'))) {
          await reserveTransactionKey(context, markerId, 'marker');
        }
        return null;
      };
      if (mutatingMethods.has(String(property))) {
        return () => { throw new Error('DB2_LEDGER_DIRECT_WRITE_FORBIDDEN: write through the transaction journal'); };
      }
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (args.length > 1) {
          const last = args[args.length - 1];
          if (last && typeof last === 'object' && !Array.isArray(last) && Object.prototype.hasOwnProperty.call(last, 'session')) {
            args[args.length - 1] = withoutClientSession(last);
          }
        }
        return value.apply(target, args);
      };
    },
  });
}

async function findTransactionHistoryByIdempotency(type, key) {
  if (!key) return null;
  if (!historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const query = { type, 'meta.idempotencyKey': String(key) };
  const existing = await historyDb.collection(HISTORY_COLLECTION).findOne(query);
  if (existing) return existing;
  const context = transactionContext.getStore();
  if (!context) throw new Error('DB2_IDEMPOTENCY_CONTEXT_REQUIRED');
  await reserveTransactionKey(context, String(type) + ':' + String(key), 'idempotency');
  return null;
}

async function assertNoUnresolvedTransactionJournal() {
  const cutoff = new Date(Date.now() - RECONCILIATION_GRACE_MS);
  const journal = historyDb.collection(TX_JOURNAL_COLLECTION);
  const unresolved = await journal.findOne({
    $or: [
      { status: 'reconciliation_required' },
      { status: 'prepared', createdAt: { $lte: cutoff } },
    ],
  }, { projection: { _id: 1, status: 1, createdAt: 1 } });
  if (unresolved) {
    throw new Error('DB2_TRANSACTION_RECONCILIATION_REQUIRED:' + String(unresolved._id));
  }
}

async function writePreparedTransactionJournal(context) {
  const journal = historyDb.collection(TX_JOURNAL_COLLECTION);
  await journal.updateOne(
    { _id: context.operationId },
    {
      $set: {
        status: 'prepared',
        entries: context.entries,
        reservationIds: context.reservationIds,
        entryCount: context.entries.length,
        updatedAt: new Date(),
      },
      $setOnInsert: { createdAt: context.startedAt, operationId: context.operationId },
    },
    { upsert: true },
  );
}

async function finalizeTransactionJournal(operationId) {
  const session = historyClient.startSession();
  try {
    await session.withTransaction(async () => {
      const journal = historyDb.collection(TX_JOURNAL_COLLECTION);
      const reservations = historyDb.collection(TX_RESERVATIONS_COLLECTION);
      const ledger = historyDb.collection(HISTORY_COLLECTION);
      const record = await journal.findOne({ _id: operationId }, { session });
      if (!record) throw new Error('DB2_TRANSACTION_JOURNAL_NOT_FOUND');
      if (record.status === 'committed') return;
      if (record.status !== 'prepared' && record.status !== 'reconciliation_required') {
        throw new Error('DB2_TRANSACTION_JOURNAL_NOT_PREPARED');
      }
      const entries = Array.isArray(record.entries) ? record.entries : [];
      for (const entry of entries) {
        await ledger.updateOne({ _id: entry._id }, { $setOnInsert: entry }, { upsert: true, session });
        const stored = await ledger.findOne({ _id: entry._id }, { session });
        if (!stored || JSON.stringify(ledgerStableValue(stored)) !== JSON.stringify(ledgerStableValue(entry))) {
          throw new Error('DB2_LEDGER_CONTENT_MISMATCH:' + String(entry._id));
        }
      }
      await journal.updateOne(
        { _id: operationId, status: { $in: ['prepared', 'reconciliation_required'] } },
        {
          $set: {
            status: 'committed',
            entryCount: entries.length,
            committedAt: new Date(),
            updatedAt: new Date(),
          },
          $unset: { entries: '', reservationIds: '' },
        },
        { session },
      );
      await reservations.deleteMany({ operationId }, { session });
    });
  } finally {
    await session.endSession().catch(() => {});
  }
}

async function setTransactionJournalState(operationId, status, error) {
  try {
    const journal = historyDb.collection(TX_JOURNAL_COLLECTION);
    if (status === 'aborted') {
      await journal.updateOne(
        { _id: operationId, status: 'prepared' },
        { $set: { status, error: String(error?.message || error || 'aborted').slice(0, 500), updatedAt: new Date(), abortedAt: new Date() }, $unset: { entries: '', reservationIds: '' } },
      );
      await historyDb.collection(TX_RESERVATIONS_COLLECTION).deleteMany({ operationId });
      return;
    }
    await journal.updateOne(
      { _id: operationId, status: 'prepared' },
      { $set: { status: 'reconciliation_required', error: String(error?.message || error || 'unknown commit result').slice(0, 500), updatedAt: new Date() } },
    );
  } catch (stateError) {
    logger.error('Unable to update DB2 transaction journal state for ' + operationId, stateError);
  }
}


async function connectMongo() {
  client = new MongoClient(env.MONGO_URI, { maxPoolSize: 20, minPoolSize: 1, retryWrites: true });
  try {
    await client.connect();
    db = client.db(env.DB_NAME);
    // Non-mutating capability check: createIndex can fail even if simple writes
    // still work. If Atlas reports the specific storage-quota lock, skip the
    // redundant index probe below and mark money transactions read-only.
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

  await connectTransactionHistory();

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
  // Legacy cleanup timer was removed for this branch to prevent deleting records before migration/verification.
  startTransactionHistoryOutbox();
  logger.info('Mongo connected: DB1 app data, DB2 authoritative transaction ledger');
}


function getDb() { if (!db) throw new Error('DB_NOT_CONNECTED'); return db; }
function col(name) { if (name === 'transactions') return transactionLedgerFacade(); if (!collections[name]) throw new Error(`COLLECTION_NOT_READY:${name}`); return collections[name]; }
function isHistoryReady() { return historyReady; }
function isDbOneWriteBlocked() { return dbOneWriteBlocked; }
function markDbOneWriteBlocked() { dbOneWriteBlocked = true; }
async function closeMongo() { if (client) await client.close(); if (historyClient) await historyClient.close(); }
function txUnsupported(err) {
  const m = String(err?.message || err);
  return m.includes('Transaction numbers are only allowed') || m.includes('replica set') || m.includes('does not support transactions') || (m.includes('Transaction') && m.includes('not supported'));
}
async function withMaybeTx(work) {
  if (dbOneWriteBlocked) throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
  if (env.DB_TWO_ENABLED && !historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
  if (!TX_SUPPORTED) return work(null);
  const session = client.startSession();
  try { return await session.withTransaction(() => work(session)); }
  catch (e) {
    if (txUnsupported(e)) { TX_SUPPORTED = false; logger.warn('Mongo transactions unsupported; fallback mode enabled'); return work(null); }
    throw e;
  } finally { try { await session.endSession(); } catch(_) {} }
}
async function withRequiredTx(work) {
  if (dbOneWriteBlocked) throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
  if (!historyReady || !historyDb) throw new Error('DB_TWO_HISTORY_NOT_READY');
  if (!TX_SUPPORTED) throw new Error('MONGO_TRANSACTIONS_REQUIRED');
  await assertNoUnresolvedTransactionJournal();

  const operationId = crypto.randomUUID();
  const operationStartedAt = new Date();
  const session = client.startSession();
  let journalPrepared = false;
  let dbOneCommitted = false;
  try {
    const outcome = await session.withTransaction(async () => {
      const context = {
        operationId,
        startedAt: operationStartedAt,
        entries: [],
        reservationIds: [],
      };
      const value = await transactionContext.run(context, () => work(session));
      const hasJournal = context.entries.length > 0 || context.reservationIds.length > 0;
      if (hasJournal) {
        await writePreparedTransactionJournal(context);
        journalPrepared = true;
      }
      return { value, hasJournal };
    });
    dbOneCommitted = true;

    if (outcome?.hasJournal) {
      try {
        await finalizeTransactionJournal(operationId);
      } catch (err) {
        await setTransactionJournalState(operationId, 'reconciliation_required', err);
        throw new Error('DB2_LEDGER_RECONCILIATION_REQUIRED:' + operationId, { cause: err });
      }
    }
    return outcome?.value;
  } catch (err) {
    if (!dbOneCommitted) {
      const uncertainCommit = Boolean(
        err?.hasErrorLabel?.('UnknownTransactionCommitResult') ||
        /UnknownTransactionCommitResult|unknown transaction commit/i.test(String(err?.message || err))
      );
      if (journalPrepared && uncertainCommit) {
        await setTransactionJournalState(operationId, 'reconciliation_required', err);
      } else {
        await setTransactionJournalState(operationId, 'aborted', err);
        // Also release reservations created before a journal could be prepared.
        try { await historyDb.collection(TX_RESERVATIONS_COLLECTION).deleteMany({ operationId }); } catch (_) {}
      }
    }
    if (txUnsupported(err)) {
      TX_SUPPORTED = false;
      const required = new Error('MONGO_TRANSACTIONS_REQUIRED');
      required.cause = err;
      throw required;
    }
    throw err;
  } finally {
    await session.endSession().catch(() => {});
  }
}
async function pingMs(){ const s=Date.now(); try{ await getDb().command({ping:1}); return Date.now()-s; }catch(_){return null;} }
module.exports = { connectMongo, closeMongo, getDb, col, safeCreateIndex, withMaybeTx, withRequiredTx, pingMs, findTransactionHistoryByIdempotency, getTransactionHistoryDb, getTransactionHistoryCollection, getTransactionHistoryStats, getUnresolvedTransactionJournals, initializeTransactionHistoryStorage, hasVerifiedInitialMigration, isHistoryReady, isDbOneWriteBlocked, markDbOneWriteBlocked };