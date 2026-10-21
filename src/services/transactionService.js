'use strict';

const { ObjectId } = require('mongodb');
const { col, isHistoryConfigured, isDbOneWriteBlocked, markDbOneWriteBlocked } = require('../config/database');

async function logTx(doc, opts = {}) {
  if (!isHistoryConfigured()) throw new Error('DB_TWO_HISTORY_NOT_CONFIGURED');
  if (isDbOneWriteBlocked()) throw new Error('DB1_TRANSACTION_OUTBOX_STORAGE_QUOTA_BLOCKED');

  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  const ledgerId = doc._id ?? new ObjectId();
  const ledgerDoc = { ...doc, _id: ledgerId, createdAt };

  try {
    // This write is in the same DB1 transaction as the balance/treasury update.
    // A remote DB2 outage or quota limit cannot erase the intent: a worker retries
    // this durable outbox row until the idempotent DB2 upsert succeeds.
    return await col('transaction_outbox').insertOne({
      targetId: ledgerId,
      sourceId: ledgerId,
      status: 'pending',
      payload: ledgerDoc,
      attempts: 0,
      createdAt,
      updatedAt: createdAt,
    }, opts);
  } catch (err) {
    // An outbox insert is a DB1 write. If DB1 is quota-blocked the containing
    // transaction must abort, so no balance mutation can commit without intent.
    if (err?.code === 8000 || err?.codeName === 'AtlasError' || /over your space quota|writes are blocked on your cluster/i.test(String(err?.message || err))) {
      markDbOneWriteBlocked();
      throw new Error('DB1_TRANSACTION_OUTBOX_STORAGE_QUOTA_BLOCKED', { cause: err });
    }
    throw err;
  }
}
module.exports = { logTx };
