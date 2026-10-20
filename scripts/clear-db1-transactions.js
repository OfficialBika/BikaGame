'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');

const CONFIRM_FLAG = '--confirm-delete-db1-transactions';
const BACKUP_FLAG = '--backup-jsonl';
const BATCH_SIZE = 200;

function parseArgs(argv) {
  const args = { confirm: false, backup: false, dryRun: false };
  for (const arg of argv) {
    if (arg === CONFIRM_FLAG) args.confirm = true;
    else if (arg === BACKUP_FLAG) args.backup = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help') {
      console.log('Usage: node scripts/clear-db1-transactions.js --dry-run');
      console.log('       node scripts/clear-db1-transactions.js ' + CONFIRM_FLAG + ' ' + BACKUP_FLAG);
      console.log('Safety guards require explicit DB1/DB2 settings, no pending outbox rows, a backup, and exact DB2 verification.');
      process.exit(0);
    } else throw new Error('Unknown argument: ' + arg);
  }
  return args;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') };
  return value;
}

async function verifyCopy(source, target, expectedCount) {
  let scanned = 0;
  let missing = 0;
  let mismatched = 0;
  let batch = [];

  async function verifyBatch(docs) {
    if (!docs.length) return;
    const found = await target.find({ _id: { $in: docs.map((doc) => doc._id) } }).toArray();
    const byId = new Map(found.map((doc) => [String(doc._id), doc]));
    for (const doc of docs) {
      const counterpart = byId.get(String(doc._id));
      if (!counterpart) missing += 1;
      else if (JSON.stringify(stable(doc)) !== JSON.stringify(stable(counterpart))) mismatched += 1;
    }
  }

  for await (const doc of source.find({}).sort({ _id: 1 }).batchSize(BATCH_SIZE)) {
    scanned += 1;
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) {
      await verifyBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await verifyBatch(batch);

  const sourceCountAfter = await source.countDocuments({});
  const targetCount = await target.countDocuments({});
  return {
    scanned,
    sourceCountAfter,
    targetCount,
    missing,
    mismatched,
    verified: scanned === expectedCount && sourceCountAfter === expectedCount &&
      missing === 0 && mismatched === 0 && targetCount >= expectedCount,
  };
}

async function exportBackup(collection) {
  const backupDir = path.resolve(process.env.TRANSACTION_BACKUP_DIR || './backups');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(
    backupDir,
    'db1-transactions-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl'
  );
  const fd = fs.openSync(backupPath, 'wx', 0o600);
  try {
    for await (const doc of collection.find({}).sort({ _id: 1 })) {
      // MongoDB Extended JSON preserves ObjectId/Date/Binary types for restoration.
      fs.writeSync(fd, require('mongodb').EJSON.stringify(doc, { relaxed: false }) + '\n');
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return backupPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.MONGO_URI || !process.env.MONGO_URI_2 || !process.env.DB_TWO_NAME) {
    throw new Error('Missing MONGO_URI, MONGO_URI_2 or DB_TWO_NAME');
  }
  if (!process.env.DB_NAME) throw new Error('Set DB_NAME explicitly to the intended DB1 database');
  if (String(process.env.DB_TWO_ENABLED || '').toLowerCase() !== 'true') {
    throw new Error('Refusing: DB_TWO_ENABLED=true is required');
  }
  if (!args.dryRun && (!args.confirm || !args.backup)) {
    throw new Error('Refusing deletion: provide both ' + CONFIRM_FLAG + ' and ' + BACKUP_FLAG);
  }

  const sourceClient = new MongoClient(process.env.MONGO_URI, { maxPoolSize: 2, minPoolSize: 0, retryWrites: true });
  const targetClient = new MongoClient(process.env.MONGO_URI_2, { maxPoolSize: 2, minPoolSize: 0, retryWrites: true });
  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    const sourceDb = sourceClient.db(process.env.DB_NAME);
    const targetDb = targetClient.db(process.env.DB_TWO_NAME);
    await Promise.all([sourceDb.command({ ping: 1 }), targetDb.command({ ping: 1 })]);

    // Don't accept the same endpoint/database as two separate stores.
    const sourceHost = new URL(process.env.MONGO_URI).host;
    const targetHost = new URL(process.env.MONGO_URI_2).host;
    if (sourceHost === targetHost && sourceDb.databaseName === targetDb.databaseName) {
      throw new Error('DB1 and DB2 resolve to the same MongoDB host/database; refusing cleanup');
    }

    const source = sourceDb.collection('transactions');
    const target = targetDb.collection('transactions');
    const outbox = sourceDb.collection('transaction_outbox');

    const [sourceCount, targetCount, pendingOutbox, sourceStats] = await Promise.all([
      source.countDocuments({}),
      target.countDocuments({}),
      outbox.countDocuments({ status: 'pending' }).catch((err) => {
        if (err && (err.codeName === 'NamespaceNotFound' || err.code === 26)) return 0;
        throw err;
      }),
      source.stats().catch(() => null),
    ]);

    const report = {
      action: args.dryRun ? 'dry-run-only' : 'delete-db1-transactions',
      sourceDatabase: sourceDb.databaseName,
      targetDatabase: targetDb.databaseName,
      sourceCollection: 'transactions',
      targetCollection: 'transactions',
      sourceCount,
      targetCount,
      pendingOutbox,
      sourceStorageSizeBytes: sourceStats?.storageSize ?? null,
      deleted: 0,
      backup: null,
    };

    if (args.dryRun) {
      const verification = await verifyCopy(source, target, sourceCount);
      report.copyVerification = verification;
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (pendingOutbox > 0) {
      throw new Error('Pending transaction_outbox records exist. Resolve/flush them before deletion; this script never bypasses this guard.');
    }
    if (sourceCount === 0) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Exact logical copy verification before making a restorable backup.
    const verification = await verifyCopy(source, target, sourceCount);
    report.copyVerification = verification;
    if (!verification.verified) throw new Error('DB2 transaction history verification failed; no DB1 deletion performed');

    const pendingBeforeDelete = await outbox.countDocuments({ status: 'pending' }).catch((err) => {
      if (err && (err.codeName === 'NamespaceNotFound' || err.code === 26)) return 0;
      throw err;
    });
    if (pendingBeforeDelete !== 0) throw new Error('Pending outbox records found before deletion; no DB1 deletion performed');

    report.backup = await exportBackup(source);
    // Re-check copy and source counts after backup in case another writer raced this cleanup.
    const postBackupVerify = await verifyCopy(source, target, sourceCount);
    if (!postBackupVerify.verified) throw new Error('DB1/DB2 changed during backup; no DB1 deletion performed; keep backup at ' + report.backup);

    const pendingFinal = await outbox.countDocuments({ status: 'pending' }).catch((err) => {
      if (err && (err.codeName === 'NamespaceNotFound' || err.code === 26)) return 0;
      throw err;
    });
    if (pendingFinal !== 0) throw new Error('Pending outbox appeared during final verification; no DB1 deletion performed; keep backup at ' + report.backup);

    // Only the historical transaction collection is deleted. Balances, treasury,
    // settlement/business data, and DB2 are intentionally untouched.
    const deletion = await source.deleteMany({});
    report.deleted = Number(deletion.deletedCount || 0);
    report.finalVerification = postBackupVerify;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.all([sourceClient.close().catch(() => {}), targetClient.close().catch(() => {})]);
  }
}

main().catch((err) => {
  console.error('DB1_TRANSACTION_CLEANUP_FAILED:', err?.stack || err);
  process.exitCode = 1;
});
