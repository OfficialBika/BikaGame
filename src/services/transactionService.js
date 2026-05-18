const txModel = require('../models/transactionModel');
async function logTx(doc, opts={}){ return txModel.collection().insertOne({ ...doc, createdAt: new Date() }, opts); }
module.exports = { logTx };
