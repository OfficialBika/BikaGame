'use strict';

const { col, isHistoryReady } = require('../config/database');

async function logTx(doc) {
  if (!isHistoryReady()) throw new Error('DB_TWO_HISTORY_NOT_READY');
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  // col('transactions') queues this record in DB2's durable transaction journal.
  // It is finalized into DB2.transactions only after the DB1 balance transaction commits.
  return col('transactions').insertOne({ ...doc, createdAt });
}

module.exports = { logTx };
