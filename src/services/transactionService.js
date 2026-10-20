'use strict';

const { enqueueTransactionHistory, col, isHistoryReady, isDbOneWriteBlocked } = require('../config/database');

async function logTx(doc, opts = {}) {
  if (!isHistoryReady()) throw new Error('DB_TWO_HISTORY_NOT_READY');
  if (isDbOneWriteBlocked()) throw new Error('DB1_STORAGE_QUOTA_BLOCKED');

  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  const ledgerDoc = { ...doc, createdAt };
  try {
    const result = await col('transactions').insertOne(ledgerDoc, opts);
    if (!String(ledgerDoc._id || '').startsWith('__settlement:')) {
      await enqueueTransactionHistory(ledgerDoc, opts.session);
    }
    return result;
  } catch (err) {
    // Set the process readiness flag if the quota error appears on a regular write.
    if (err?.code === 8000 || err?.codeName === 'AtlasError' || /over your space quota|writes are blocked on your cluster/i.test(String(err?.message || err))) {
      throw new Error('DB1_STORAGE_QUOTA_BLOCKED');
    }
    throw err;
  }
}
module.exports = { logTx };
