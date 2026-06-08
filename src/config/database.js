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

  await safeCreateIndex(collections.users, { userId: 1 }, { unique: true });
  await safeCreateIndex(collections.users, { username: 1 }, { sparse: true });
  await safeCreateIndex(collections.users, { balance: -1 });

  await safeCreateIndex(collections.transactions, { createdAt: -1 });
  await safeCreateIndex(collections.transactions, { userId: 1, createdAt: -1 });

  await safeCreateIndex(collections.orders, { status: 1, createdAt: -1 });
  await safeCreateIndex(collections.orders, { userId: 1, createdAt: -1 });
  await safeCreateIndex(collections.orders, { rarity: 1, createdAt: -1 });
  await safeCreateIndex(collections.orders, { cardId: 1 }, { sparse: true });

  await safeCreateIndex(collections.config, { key: 1 }, { unique: true });

  await safeCreateIndex(collections.groups, { groupId: 1 }, { unique: true });
  await safeCreateIndex(collections.groups, { approvalStatus: 1, updatedAt: -1 });

  await safeCreateIndex(collections.shop_cards, { cardId: 1 }, { unique: true });
  await safeCreateIndex(collections.shop_cards, { rarity: 1, status: 1, cardId: 1 });
  await safeCreateIndex(collections.shop_cards, { status: 1, updatedAt: -1 });
  await safeCreateIndex(collections.shop_cards, { soldToUserId: 1, soldAt: -1 });

  await safeCreateIndex(collections.shop_settings, { key: 1 }, { unique: true });

  logger.info('Mongo connected');
}
function getDb() { if (!db) throw new Error('DB_NOT_CONNECTED'); return db; }
function col(name) { if (!collections[name]) throw new Error(`COLLECTION_NOT_READY:${name}`); return collections[name]; }
async function closeMongo() { if (client) await client.close(); }
function txUnsupported(err) { const m=String(err?.message||err); return m.includes('Transaction numbers are only allowed')||m.includes('replica set')||m.includes('does not support transactions')||(m.includes('Transaction')&&m.includes('not supported')); }
async function withMaybeTx(work) {
  if (!TX_SUPPORTED) return work(null);
  const session = client.startSession();
  try { return await session.withTransaction(() => work(session)); }
  catch(e) { if (txUnsupported(e)) { TX_SUPPORTED=false; logger.warn('Mongo transactions unsupported; fallback mode enabled'); return work(null); } throw e; }
  finally { try { await session.endSession(); } catch(_){} }
}
async function pingMs(){ const s=Date.now(); try{ await getDb().command({ping:1}); return Date.now()-s; }catch(_){return null;} }
module.exports = { connectMongo, closeMongo, getDb, col, withMaybeTx, pingMs };
