'use strict';

const { enqueueTransactionHistory, col } = require('../config/database');

async function logTx(doc, opts = {}) {
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  const ledgerDoc = { ...doc, createdAt };
  const result = await col('transactions').insertOne(ledgerDoc, opts);
  if (!String(ledgerDoc._id || '').startsWith('__settlement:')) {
    await enqueueTransactionHistory(ledgerDoc, opts.session);
  }
  return result;
}
module.exports = { logTx };
