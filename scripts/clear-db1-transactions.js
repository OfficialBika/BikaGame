'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');

const CONFIRM_FLAG = '--confirm-delete-db1-transactions';
const BACKUP_FLAG = '--backup-jsonl';
const ALLOW_PENDING_FLAG = '--allow-pending-outbox';

function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}

function parseArgs(argv) {
  const args = { confirm: false, backup: false, allowPendingOutbox: false, dryRun: false };
  for (const arg of argv) {
    if (arg === CONFIRM_FLAG) args.confirm = true;
    else if (arg === BACKUP_FLAG) args.backup = true;
    else if (arg === ALLOW_PENDING_FLAG) args.allowPendingOutbox = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help') {
      console.log('Usage: node scripts/clear-db1-transactions.js --dry-run');
      console.log('       node scripts/clear-db1-transactions.js ' + CONFIRM_FLAG + ' ' + BACKUP_FLAG);
      console.log('Optional ' + ALLOW_PENDING_FLAG + ' bypasses the pending-outbox guard (not recommended).');
      process.exit(0);
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.MONGO_URI) throw new Error('Missing MONGO_URI');
  if (!process.env.DB_NAME) throw new Error('Set DB_NAME explicitly to the intended DB1 database');
  if (String(process.env.DB_TWO_ENABLED || '').toLowerCase() !== 'true') {
    throw new Error('Refusing: DB_TWO_ENABLED=true is required');
  }
  if (!process.env.MONGO_URI_2 || !process.env.DB_TWO_NAME) {
    throw new Error('Refusing: MONGO_URI_2 and DB_TWO_NAME are required');
  }
  if (!args.dryRun && (!args.confirm || !args.backup)) {
    throw new Error('Refusing deletion: provide both ' + CONFIRM_FLAG + ' and ' + BACKUP_FLAG);
  }

  const sourceClient = new MongoClient(process.env.MONGO_URI, { maxPoolSize: 2, minPoolSize: 0, retryWrites: true });
  const targetClient = new MongoClient(process.env.MONGO_URI_2, { maxPoolSize: 2, minPoolSize: 0, retryWrites: true });
  let sourceDb;
  let targetDb;
  try {
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    sourceDb = sourceClient.db(process.env.DB_NAME);
    targetDb = targetClient.db(process.env.DB_TWO_NAME);
    await Promise.all([sourceDb.command({ ping: 1 }), targetDb.command({ ping: 1 })]);

    // Verify an intentional database separation before any destructive action.
    if (String(sourceDb.databaseName) === String(targetDb.databaseName) &&
        String(process.env.MONGO_URI) === String(process.env.MONGO_URI_2)) {
      throw new Error('DB1 and DB2 point to the same URI/database; refusing cleanup');
    }

    const source = sourceDb.collection('transactions');
    const target = targetDb.collection('transactions');
    const outbox = sourceDb.collection('transaction_outbox');

    const [sourceCount, targetCount, pendingOutbox, sourceStats, targetStats] = await Promise.all([
      source.countDocuments({}),
      target.countDocuments({}),
      outbox.countDocuments({ status: 'pending' }).catch((err) => {
        if (err && (err.codeName === 'NamespaceNotFound' || err.code === 26)) return 0;
        throw err;
      }),
      source.stats().catch(() => null),
      target.stats().catch(() => null),
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
      targetStorageSizeBytes: targetStats?.storageSize ?? null,
      deleted: 0,
      backup: null,
    };

    if (args.dryRun) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (!args.allowPendingOutbox && pendingOutbox > 0) {
      throw new Error('Pending outbox records exist. Flush/resolve them before deleting DB1 transactions, or explicitly pass ' + ALLOW_PENDING_FLAG);
    }
    if (sourceCount === 0) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Export a durable JSON Lines backup from DB1 before deleting any document.
    // Use a create-new path so this script cannot silently overwrite an older backup.
    const fs = require('fs');
    const path = require('path');
    const backupDir = path.resolve(process.env.TRANSACTION_BACKUP_DIR || './backups');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const backupPath = path.join(backupDir, 'db1-transactions-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
    const backupFd = fs.openSync(backupPath, 'wx', 0o600);
    try {
      const cursor = source.find({}).sort({ _id: 1 });
      for await (const doc of cursor) {
        fs.writeSync(backupFd, JSON.stringify(doc, (key, value) => {
          if (value && typeof value === 'object' && value._bsontype === 'ObjectId') return { $oid: value.toString() };
          if (value instanceof Date) return { $date: value.toISOString() };
          if (Buffer.isBuffer(value)) return { $binary: value.toString('base64') };
          return value;
        }) + '\n');
      }
      fs.fsyncSync(backupFd);
    } finally {
      fs.closeSync(backupFd);
    }

    // Refuse deletion unless DB2 contains every DB1 ID and the logical content is equal.
    // Compare batches by ID, then remove only the old transaction history from DB1.
    const stable = (value) => {
      if (Array.isArray(value)) return value.map(stable);
      if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
      }
      if (value instanceof Date) return { __date: value.toISOString() };
      if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') };
      return value;
    };

    let missing = 0;
    let mismatched = 0;
    let scanned = 0;
    let ids = [];
    let docs = [];
    async function verifyBatch(batch) {
      if (!batch.length) return;
      const targetDocs = await target.find({ _id: { $in: batch.map((d) => d._id) } }).toArray();
      const byId = new Map(targetDocs.map((d) => [String(d._id), d]));
      for (const d of batch) {
        const counterpart = byId.get(String(d._id));
        if (!counterpart) missing += 1;
        else if (JSON.stringify(stable(d)) !== JSON.stringify(stable(counterpart))) mismatched += 1;
      }
    }
    for await (const doc of source.find({}).sort({ _id: 1 }).batchSize(200)) {
      docs.push(doc);
      scanned += 1;
      if (docs.length >= 200) {
        await verifyBatch(docs);
        docs = [];
      }
    }
    if (docs.length) await verifyBatch(docs);

    const sourceCountAfterVerify = await source.countDocuments({});
    const pendingAfterVerify = await outbox.countDocuments({ status: 'pending' }).catch((err) => {
      if (err && (err.codeName === 'NamespaceNotFound' || err.code === 26)) return 0;
      throw err;
    });
    if (sourceCountAfterVerify !== sourceCount || scanned !== sourceCount || missing !== 0 || mismatched !== 0) {
      throw new Error('Verification failed or DB1 changed during verification; no deletion performed');
    }
    if (!args.allowPendingOutbox && pendingAfterVerify > 0) {
      throw new Error('Pending outbox records appeared during verification; no deletion performed');
    }

    // This is intentionally the only destructive database operation in this script.
    const deletion = await source.deleteMany({});
    report.deleted = Number(deletion.deletedCount || 0);
    report.verified = true;
    report.missing = missing;
    report.mismatched = mismatched;
    report.scanned = scanned;
    report.pendingOutboxAfterVerify = pendingAfterVerify;
    report.backup = backupPath;
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.all([sourceClient.close().catch(() => {}), targetClient.close().catch(() => {})]);
  }
}

main().catch((err) => {
  console.error('DB1_TRANSACTION_CLEANUP_FAILED:', err?.stack || err);
  process.exitCode = 1;
});
