'use strict';

const { col, isHistoryReady, isDbOneWriteBlocked, markDbOneWriteBlocked } = require('../config/database');

async function logTx(doc, opts = {}) {
  if (!isHistoryReady()) throw new Error('DB_TWO_HISTORY_NOT_READY');
  if (isDbOneWriteBlocked()) throw new Error('TRANSACTION_STORAGE_QUOTA_BLOCKED');

  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  const ledgerDoc = { ...doc, createdAt };
  try {
    // `col('transactions')` is routed exclusively to DB2. With the shared
    // MongoClient, opts.session makes this ledger write atomic with DB1 balance
    // and treasury updates without reading or writing DB1.transactions.
    return await col('transactions').insertOne(ledgerDoc, opts);
  } catch (err) {
    // Block financial operations if DB2 cannot accept a transaction ledger write.
    if (err?.code === 8000 || err?.codeName === 'AtlasError' || /over your space quota|writes are blocked on your cluster/i.test(String(err?.message || err))) {
      markDbOneWriteBlocked();
      throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
    }
    throw err;
  }
}
module.exports = { logTx };
