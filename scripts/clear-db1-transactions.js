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
      console.log('Safety guards require explicit DB1/DB2 settings, separate backups of DB1 transactions/outbox, and exact DB2 verification of both transactions and outbox payloads.');
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

async function verifyOutboxPayloads(outbox, target) {
  let scanned = 0;
  let missing = 0;
  let mismatched = 0;
  let batch = [];
  async function verifyBatch(rows) {
    const valid = rows.filter((row) => row?.payload && row.payload._id != null);
    missing += rows.length - valid.length;
    if (!valid.length) return;
    const ids = valid.map((row) => row.targetId || row.payload._id || row.sourceId);
    const counterparts = await target.find({ _id: { $in: ids } }).toArray();
    const byId = new Map(counterparts.map((doc) => [String(doc._id), doc]));
    for (const row of valid) {
      const targetId = row.targetId || row.payload._id || row.sourceId;
      const counterpart = byId.get(String(targetId));
      if (!counterpart) missing += 1;
      else if (JSON.stringify(stable(row.payload)) !== JSON.stringify(stable(counterpart))) mismatched += 1;
    }
  }
  for await (const row of outbox.find({}).sort({ _id: 1 }).batchSize(BATCH_SIZE)) {
    scanned += 1;
    batch.push(row);
    if (batch.length >= BATCH_SIZE) {
      await verifyBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await verifyBatch(batch);
  const countAfter = await outbox.countDocuments({});
  return { scanned, countAfter, missing, mismatched, verified: scanned === countAfter && missing === 0 && mismatched === 0 };
}

async function exportBackup(collection, collectionName) {
  const backupDir = path.resolve(process.env.TRANSACTION_BACKUP_DIR || './backups');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  const backupPath = path.join(
    backupDir,
    'db1-' + collectionName.replace(/[^a-z0-9_-]/gi, '_') + '-' +
      new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl'
  );
  const fd = fs.openSync(backupPath, 'wx', 0o600);
  try {
    for await (const doc of collection.find({}).sort({ _id: 1 })) {
      fs.writeSync(fd, require('mongodb').EJSON.stringify(doc, { relaxed: false }) + '\\n');
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

    // Avoid Collection.stats(), which uses an aggregation cursor in the Node driver.
    // The cleanup decision needs counts and exact document verification, not storage metrics.
    const [sourceCount, targetCount, outboxCount, pendingOutbox] = await Promise.all([
      source.countDocuments({}),
      target.countDocuments({}),
      outbox.countDocuments({}),
      outbox.countDocuments({ status: 'pending' }).catch((err) => {
        if (err && (err.codeName === 'NamespaceNotFound' || err.code === 26)) return 0;
        throw err;
      }),
    ]);

    const report = {
      action: args.dryRun ? 'dry-run-only' : 'delete-db1-transactions',
      sourceDatabase: sourceDb.databaseName,
      targetDatabase: targetDb.databaseName,
      sourceCollection: 'transactions',
      targetCollection: 'transactions',
      sourceCount,
      targetCount,
      outboxCount,
      pendingOutbox,
      deleted: { transactions: 0, transaction_outbox: 0 },
      backup: null,
    };

    if (args.dryRun) {
      const verification = await verifyCopy(source, target, sourceCount);
      const outboxVerification = await verifyOutboxPayloads(outbox, target);
      report.copyVerification = verification;
      report.outboxVerification = outboxVerification;
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (sourceCount === 0 && outboxCount === 0) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    // Exact logical copy verification before making a restorable backup.
    const verification = await verifyCopy(source, target, sourceCount);
    const outboxVerification = await verifyOutboxPayloads(outbox, target);
    report.copyVerification = verification;
    report.outboxVerification = outboxVerification;
    if (!verification.verified) throw new Error('DB2 transaction history verification failed; no DB1 deletion performed');
    if (!outboxVerification.verified) throw new Error('DB2 is missing one or more transaction_outbox payloads; no DB1 deletion performed');

    report.backup = {
      transactions: await exportBackup(source, 'transactions'),
      transaction_outbox: await exportBackup(outbox, 'transaction_outbox'),
    };
    // Re-check both legacy sources after backup in case an older bot instance is still writing.
    const postBackupVerify = await verifyCopy(source, target, sourceCount);
    const postBackupOutboxVerify = await verifyOutboxPayloads(outbox, target);
    const sourceCountAfterBackup = await source.countDocuments({});
    const outboxCountAfterBackup = await outbox.countDocuments({});
    if (!postBackupVerify.verified || !postBackupOutboxVerify.verified ||
        sourceCountAfterBackup !== sourceCount || outboxCountAfterBackup !== outboxCount) {
      throw new Error('DB1/DB2 changed or verification failed during backup; no DB1 deletion performed; backups retained at ' + JSON.stringify(report.backup));
    }

    // Remove only legacy transaction ledger + outbox after exact DB2 verification
    // and backups. User balances, treasury, game/event data, and DB2 are untouched.
    const [transactionsDeletion, outboxDeletion] = await Promise.all([
      source.deleteMany({}),
      outbox.deleteMany({}),
    ]);
    report.deleted = {
      transactions: Number(transactionsDeletion.deletedCount || 0),
      transaction_outbox: Number(outboxDeletion.deletedCount || 0),
    };
    report.finalVerification = { transactions: postBackupVerify, outbox: postBackupOutboxVerify };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await Promise.all([sourceClient.close().catch(() => {}), targetClient.close().catch(() => {})]);
  }
}

main().catch((err) => {
  console.error('DB1_TRANSACTION_CLEANUP_FAILED:', err?.stack || err);
  process.exitCode = 1;
});
