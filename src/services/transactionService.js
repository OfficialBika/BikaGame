'use strict';

const txModel = require('../models/transactionModel');
const { enqueueTransactionHistory } = require('../config/database');

async function logTx(doc, opts = {}) {
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  const ledgerDoc = { ...doc, createdAt };
  const result = await txModel.collection().insertOne(ledgerDoc, opts);

  // Only mirror business ledger events to DB2. DB1 settlement/idempotency
  // markers stay in the same client/session as balances and game state.
  if (!String(ledgerDoc._id || '').startsWith('__settlement:')) {
    await enqueueTransactionHistory(ledgerDoc, opts.session);
  }
  return result;
}

module.exports = { logTx };
