'use strict';

const { enqueueTransactionHistory, col } = require('../config/database');

async function logTx(doc, opts = {}) {
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  const ledgerDoc = { ...doc, createdAt };
  const result = await col('transactions').insertOne(ledgerDoc, opts);
  if (!String(ledgerDoc._id || '').startsWith('__settlement:')) {
    try {
      await enqueueTransactionHistory(ledgerDoc, opts.session);
    } catch (err) {
      // If in a DB1 transaction this must abort the whole DB1 transaction.
      // Non-transactional writes are not expected on critical money paths.
      if (opts.session) throw err;
      throw err;
    }
  }
  return result;
}
module.exports = { logTx };
