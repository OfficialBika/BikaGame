'use strict';

require('dotenv').config();
const { migrateTransactionHistoryReadOnly, closeMongo } = require('../src/config/database');

function parseArgs(argv) {
  const args = { batchSize: 100, verifyOnly: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--verify-only') args.verifyOnly = true;
    else if (arg === '--batch-size') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 1 || value > 500) {
        throw new Error('--batch-size must be an integer between 1 and 500');
      }
      args.batchSize = value;
    } else if (arg === '--help') {
      console.log('Usage: node scripts/migrate-transaction-history.js [--verify-only] [--batch-size 100]');
      process.exit(0);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  return args;
}

(async () => {
  let exitCode = 0;
  try {
    if (String(process.env.DB_TWO_ENABLED || '').toLowerCase() !== 'true') {
      throw new Error('Refusing migration: set DB_TWO_ENABLED=true.');
    }
    if (!process.env.MONGO_URI || !process.env.MONGO_URI_2 || !process.env.DB_TWO_NAME) {
      throw new Error('Missing MONGO_URI, MONGO_URI_2 or DB_TWO_NAME.');
    }
    const args = parseArgs(process.argv.slice(2));
    console.log('Starting DB1(read-only) -> DB2 transaction history migration.');
    console.log('DB1 source documents will not be updated or deleted.');
    const report = await migrateTransactionHistoryReadOnly(args);
    console.log(JSON.stringify(report, null, 2));
    if (!report.verified) {
      console.error('Verification failed. Keep DB1 data intact and do not cut over.');
      exitCode = 2;
    } else {
      console.log('Source/target content verification passed. No DB1 data was deleted.');
    }
  } catch (err) {
    console.error('HISTORY_MIGRATION_FAILED:', err?.stack || err);
    exitCode = 1;
  } finally {
    try { await closeMongo(); } catch (err) { console.error('Mongo shutdown warning:', err?.message || err); }
    process.exitCode = exitCode;
  }
})();
