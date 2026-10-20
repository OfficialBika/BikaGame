'use strict';

const txModel = require('../models/transactionModel');
const { enqueueTransactionHistory } = require('../config/database');

async function logTx(doc, opts = {}) {
  const createdAt = doc.createdAt instanceof Date ? doc.createdAt : new Date();
  const ledgerDoc = { ...doc, createdAt };
  const result = await txModel.collection().insertOne(ledgerDoc, opts);
  const enabled = String(process.env.DB_TWO_ENABLED || 'false').toLowerCase() === 'true';
  if (enabled && !String(ledgerDoc._id || '').startsWith('__settlement:')) {
    await enqueueTransactionHistory(ledgerDoc, opts.session);
  }
  return result;
}

module.exports = { logTx };
