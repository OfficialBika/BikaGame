const { MongoClient } = require('mongodb');
const { env } = require('./env');
const logger = require('../utils/logger');
let client, db;
let TX_SUPPORTED = true;
const collections = {};
let historyClient = null;
let historyDb = null;
let historyReady = false;
let dbOneWriteBlocked = false;
const OUTBOX_COLLECTION = 'transaction_outbox';
const LEGACY_CLEANUP_DISABLED = true;
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
    // A database can be online but write-blocked because it exceeded its storage
    // tier. Do not hide other index failures: only known quota errors are degraded.
    if (isStorageQuotaError(err)) {
      dbOneWriteBlocked = true;
      logger.error(`MongoDB quota blocked index creation for ${col.collectionName}; continuing startup without index ${JSON.stringify(keys)}. DB1 writes remain unavailable until the quota is resolved.`);
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
    logger.info('DB Two transaction history is disabled; using legacy DB1 ledger.');
    return;
  }
  if (!env.MONGO_URI_2) throw new Error('DB_TWO_ENABLED requires MONGO_URI_2');
  if (!env.DB_TWO_NAME) throw new Error('DB_TWO_ENABLED requires DB_TWO_NAME');

  historyClient = new MongoClient(env.MONGO_URI_2, { maxPoolSize: 10, minPoolSize: 0, retryWrites: true });
  try {
    await historyClient.connect();
    historyDb = historyClient.db(env.DB_TWO_NAME);
    await historyDb.command({ ping: 1 });
    historyReady = true;
    logger.info('DB Two transaction history connected');
  } catch (err) {
    try { await historyClient.close(); } catch (_) {}
    historyClient = null;
    historyDb = null;
    historyReady = false;
    // Do not silently fall back to DB1 for history writes when DB2 is requested.
    // The bot may start for health/recovery access, but DB2 history functionality
    // remains explicitly unavailable and must not accept money transactions.
    logger.error('DB Two connection failed; history writes are disabled until MONGO_URI_2 is fixed.', err);
    return;
  }

  // DB1 quota can block optional outbox-index creation even while read queries work.
  await safeCreateIndex(db.collection(OUTBOX_COLLECTION), { status: 1, createdAt: 1 }, { name: 'tx_outbox_status_createdAt' });
  await safeCreateIndex(db.collection(OUTBOX_COLLECTION), { sourceId: 1 }, { unique: true, name: 'tx_outbox_sourceId_unique' });
}

async function enqueueTransactionHistory(doc, session) {
  if (!env.DB_TWO_ENABLED) return null;
  if (!historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const sourceId = String(doc._id || '');
  if (!sourceId || sourceId.startsWith('__settlement:')) return null;
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt || Date.now());
  const outboxId = require('crypto').createHash('sha256').update(sourceId).digest('hex');
  const targetId = doc._id || sourceId;
  try {
    return await db.collection(OUTBOX_COLLECTION).updateOne(
      { _id: outboxId },
      { $setOnInsert: { sourceId, targetId, payload: { ...doc, createdAt }, createdAt, status: 'pending', attempts: 0 } },
      { upsert: true, ...(session ? { session } : {}) },
    );
  } catch (err) {
    if (isStorageQuotaError(err)) dbOneWriteBlocked = true;
    // DB1 can accept reads but reject all writes after Atlas quota is exceeded.
    // Callers must treat this as fatal inside transactional money flows so their
    // balance/treasury changes roll back rather than recording an untracked ledger.
    if (isStorageQuotaError(err)) {
      logger.error('DB1 is write-blocked by Atlas storage quota; DB2 ledger enqueue did not persist.', err);
      throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
    }
    throw err;
  }
}

async function initializeTransactionHistoryStorage() {
  if (!env.DB_TWO_ENABLED || !historyReady) return { skipped: true };
  // Explicit caller can choose the DB2 bootstrap step. Normal bot startup does
  // not run bulk migration and never deletes the source ledger.
  await historyDb.collection(HISTORY_COLLECTION).createIndex({ createdAt: -1 }, { name: 'tx_history_createdAt_desc' });
  await historyDb.collection(HISTORY_COLLECTION).createIndex({ userId: 1, createdAt: -1 }, { name: 'tx_history_user_createdAt' });
  await historyDb.collection(HISTORY_COLLECTION).createIndex({ type: 1, 'meta.eventId': 1, toUserId: 1 }, { name: 'tx_history_type_event_toUser' });
  return { ready: true };
}

async function flushTransactionHistoryOutbox({ batchSize = 100, allowBeforeInitialMigration = false } = {}) {
  if (!env.DB_TWO_ENABLED) return { skipped: true, processed: 0 };
  if (!historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
  // Initial migration can flush pre-cutover outbox rows; live delivery stays gated
  // until a full copy + exact verification has succeeded.
  if (!allowBeforeInitialMigration && !(await hasVerifiedInitialMigration())) {
    throw new Error('DB_TWO_HISTORY_NOT_VERIFIED: run the reviewed migration and verify the complete source copy first');
  }
  const pending = await db.collection(OUTBOX_COLLECTION)
    .find({ status: 'pending' }).sort({ createdAt: 1 }).limit(batchSize).toArray();
  let processed = 0;
  const outbox = db.collection(OUTBOX_COLLECTION);
  const target = historyDb.collection(HISTORY_COLLECTION);
  for (const row of pending) {
    try {
      const payload = row.payload;
      const targetId = row.targetId || payload._id || row.sourceId;
      await copyVerifiedHistoryDocument({ ...payload, _id: targetId });
      await outbox.updateOne({ _id: row._id, status: 'pending' }, { $set: { status: 'delivered', deliveredAt: new Date() }, $inc: { attempts: 1 } });
      processed += 1;
    } catch (err) {
      await outbox.updateOne({ _id: row._id, status: 'pending' }, { $inc: { attempts: 1 }, $set: { lastError: String(err?.message || err).slice(0, 500), lastAttemptAt: new Date() } });
      logger.error('DB Two transaction history delivery failed for ' + row.sourceId, err);
      break;
    }
  }
  return { skipped: false, processed };
}

async function findTransactionHistoryByIdempotency(type, key, session) {
  if (!key) return null;
  const query = { type, 'meta.idempotencyKey': key };
  // DB1 is authoritative for money operations. A DB2 history copy is not a
  // transactional idempotency gate, because it may lag behind the outbox.
  return collections.transactions.findOne(query, session ? { session } : {});
}


async function recordTransactionMigrationReport(sourceStats, targetStats, copied, verified) {
  if (!env.DB_TWO_ENABLED || !historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const report = {
    _id: 'initial-transactions-migration-v1',
    migration: 'transactions-v1',
    source: sourceStats,
    target: targetStats,
    copied,
    verified,
    checkedAt: new Date(),
    status: verified ? 'verified' : 'verification_failed',
    missingSourceIds: copied?.missing ?? null,
    contentMismatches: copied?.mismatched ?? null,
  };
  await historyDb.collection('_migration_reports').updateOne(
    { _id: report._id }, { $set: report }, { upsert: true },
  );
  return report;
}

async function getTransactionHistoryStats() {
  if (!env.DB_TWO_ENABLED || !historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const source = collections.transactions;
  const target = historyDb.collection(HISTORY_COLLECTION);
  const [sourceCount, targetCount, pendingOutbox, deliveredOutbox, sourceStats, targetStats] = await Promise.all([
    source.countDocuments({}),
    target.countDocuments({}),
    db.collection(OUTBOX_COLLECTION).countDocuments({ status: 'pending' }),
    db.collection(OUTBOX_COLLECTION).countDocuments({ status: 'delivered' }),
    source.stats().catch(() => null),
    target.stats().catch(() => null),
  ]);
  return {
    source: { count: sourceCount, storageSize: sourceStats?.storageSize ?? null, totalIndexSize: sourceStats?.totalIndexSize ?? null },
    target: { count: targetCount, storageSize: targetStats?.storageSize ?? null, totalIndexSize: targetStats?.totalIndexSize ?? null },
    outbox: { pending: pendingOutbox, delivered: deliveredOutbox },
  };
}

async function hasVerifiedInitialMigration() {
  if (!env.DB_TWO_ENABLED || !historyReady) return false;
  const report = await historyDb.collection('_migration_reports').findOne({ _id: 'initial-transactions-migration-v1', verified: true });
  return !!report;
}

async function migrateTransactionHistory({ batchSize = 100, maxDocuments = Infinity } = {}) {
  if (!env.DB_TWO_ENABLED || !historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) throw new Error('INVALID_BATCH_SIZE');
  if (!(maxDocuments === Infinity || (Number.isInteger(maxDocuments) && maxDocuments > 0))) throw new Error('INVALID_MAX_DOCUMENTS');

  const source = collections.transactions;
  const target = historyDb.collection(HISTORY_COLLECTION);
  const migrationId = 'initial-transactions-migration-v1';
  const sourceCountBefore = await source.countDocuments({});
  const targetCountBefore = await target.countDocuments({});

  await target.createIndex({ createdAt: -1 }, { name: 'tx_history_createdAt_desc' });
  await target.createIndex({ userId: 1, createdAt: -1 }, { name: 'tx_history_user_createdAt' });
  await target.createIndex({ type: 1, 'meta.eventId': 1, toUserId: 1 }, { name: 'tx_history_type_event_toUser' });

  let copied = 0;
  const copyCursor = source.find({}).sort({ _id: 1 }).batchSize(batchSize);
  let copyBatchDocs = [];
  async function copyBatch(docs) {
    if (!docs.length) return;
    const ops = docs.map((doc) => ({
      updateOne: { filter: { _id: doc._id }, update: { $setOnInsert: doc }, upsert: true },
    }));
    await target.bulkWrite(ops, { ordered: false });
    copied += docs.length;
  }
  for await (const doc of copyCursor) {
    if (copied >= maxDocuments) break;
    copyBatchDocs.push(doc);
    if (copyBatchDocs.length >= Math.min(batchSize, maxDocuments - copied)) {
      await copyBatch(copyBatchDocs);
      copyBatchDocs = [];
    }
  }
  if (copyBatchDocs.length && copied < maxDocuments) await copyBatch(copyBatchDocs);

  // Verify source documents byte-for-logical-value, not just matching _id.
  let missing = 0;
  let mismatched = 0;
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    }
    if (value instanceof Date) return { __date: value.toISOString() };
    if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') };
    return value;
  };
  const verifyCursor = source.find({}).batchSize(batchSize);
  let verifyBatchDocs = [];
  async function verifyBatch(sourceDocs) {
    if (!sourceDocs.length) return;
    const ids = sourceDocs.map((doc) => doc._id);
    const found = await target.find({ _id: { $in: ids } }).toArray();
    const targetById = new Map(found.map((doc) => [String(doc._id), doc]));
    for (const sourceDoc of sourceDocs) {
      const targetDoc = targetById.get(String(sourceDoc._id));
      if (!targetDoc) { missing += 1; continue; }
      if (JSON.stringify(stable(sourceDoc)) !== JSON.stringify(stable(targetDoc))) mismatched += 1;
    }
  }
  for await (const doc of verifyCursor) {
    verifyBatchDocs.push(doc);
    if (verifyBatchDocs.length >= batchSize) {
      await verifyBatch(verifyBatchDocs);
      verifyBatchDocs = [];
    }
  }
  if (verifyBatchDocs.length) await verifyBatch(verifyBatchDocs);

  // A second flush catches new outbox records committed during the copy. A clean cutover
  // still requires pausing writes and running this migration again before verification.
  await flushTransactionHistoryOutbox({ batchSize: 500, allowBeforeInitialMigration: true });
  const sourceCountAfter = await source.countDocuments({});
  const targetCount = await target.countDocuments({});
  const pendingOutbox = await db.collection(OUTBOX_COLLECTION).countDocuments({ status: 'pending' });
  const sourceStable = sourceCountAfter === sourceCountBefore;
  const verified = maxDocuments === Infinity &&
    missing === 0 &&
    mismatched === 0 &&
    targetCount >= sourceCountAfter &&
    sourceStable &&
    pendingOutbox === 0;

  const report = {
    _id: migrationId,
    migration: 'transactions-v1',
    source: { countBefore: sourceCountBefore, countAfter: sourceCountAfter },
    target: { countBefore: targetCountBefore, countAfter: targetCount },
    copied: { attempted: copied, missing, mismatched, pendingOutbox },
    verified,
    sourceStable,
    checkedAt: new Date(),
    status: verified ? 'verified' : 'verification_failed',
  };
  await historyDb.collection('_migration_reports').updateOne(
    { _id: migrationId },
    { $set: report },
    { upsert: true },
  );
  return report;
}

async function copyVerifiedHistoryDocument(sourceDoc) {
  if (!env.DB_TWO_ENABLED || !historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const target = historyDb.collection(HISTORY_COLLECTION);
  const targetId = sourceDoc._id;
  await target.updateOne({ _id: targetId }, { $setOnInsert: sourceDoc }, { upsert: true });
  const stored = await target.findOne({ _id: targetId });
  if (!stored) throw new Error('DB_TWO_HISTORY_VERIFY_FAILED');
  const stable = (value) => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
    }
    if (value instanceof Date) return { __date: value.toISOString() };
    if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') };
    return value;
  };
  if (JSON.stringify(stable(sourceDoc)) !== JSON.stringify(stable(stored))) {
    throw new Error('DB_TWO_HISTORY_CONTENT_MISMATCH');
  }
  return { verified: true, id: String(targetId) };
}

async function getTransactionHistoryCollection() {
  if (env.DB_TWO_ENABLED) {
    if (!historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
    return historyDb.collection(HISTORY_COLLECTION);
  }
  return db.collection('transactions');
}

async function getTransactionHistoryDb() {
  if (env.DB_TWO_ENABLED) {
    if (!historyReady) throw new Error('DB_TWO_HISTORY_NOT_READY');
    return historyDb;
  }
  return db;
}

let historyOutboxTimer = null;
function startTransactionHistoryOutbox() {
  if (!env.DB_TWO_ENABLED || historyOutboxTimer) return;
  historyOutboxTimer = setInterval(() => {
    flushTransactionHistoryOutbox().catch((err) => logger.error('DB Two history outbox flush failed', err));
  }, 5000);
  if (typeof historyOutboxTimer.unref === 'function') historyOutboxTimer.unref();
}
async function stopTransactionHistoryOutbox() {
  if (historyOutboxTimer) clearInterval(historyOutboxTimer);
  historyOutboxTimer = null;
  if (env.DB_TWO_ENABLED) {
    try { await flushTransactionHistoryOutbox({ batchSize: 1000 }); } catch (err) { logger.error('Final DB Two history flush failed', err); }
  }
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

  await connectTransactionHistory();

  await safeCreateIndex(collections.users, { userId: 1 }, { unique: true });
  await safeCreateIndex(collections.users, { username: 1 }, { sparse: true });
  await safeCreateIndex(collections.users, { balance: -1 });
  await safeCreateIndex(collections.transactions, { _id: 1 }, { name: 'transactions_marker_id' });
  await safeCreateIndex(collections.transactions, { type: 1, 'meta.idempotencyKey': 1 });
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
  // Legacy cleanup timer was removed for this branch to prevent deleting records before migration/verification.
  startTransactionHistoryOutbox();
  logger.info('Mongo connected');
}
function getDb() { if (!db) throw new Error('DB_NOT_CONNECTED'); return db; }
function col(name) { if (!collections[name]) throw new Error(`COLLECTION_NOT_READY:${name}`); return collections[name]; }
function isHistoryReady() { return !env.DB_TWO_ENABLED || historyReady; }
function isDbOneWriteBlocked() { return dbOneWriteBlocked; }
function isHistoryReady() { return !env.DB_TWO_ENABLED || historyReady; }
function isDbOneWriteBlocked() { return dbOneWriteBlocked; }
async function closeMongo() { await stopTransactionHistoryOutbox(); if (client) await client.close(); if (historyClient) await historyClient.close(); }
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
module.exports = { connectMongo, closeMongo, getDb, col, withMaybeTx, withRequiredTx, pingMs, enqueueTransactionHistory, flushTransactionHistoryOutbox, findTransactionHistoryByIdempotency, getTransactionHistoryDb, getTransactionHistoryCollection, getTransactionHistoryStats, initializeTransactionHistoryStorage, hasVerifiedInitialMigration, copyVerifiedHistoryDocument, migrateTransactionHistory, isHistoryReady, isDbOneWriteBlocked };