'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');

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

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  if (value instanceof Date) return { __date: value.toISOString() };
  if (Buffer.isBuffer(value)) return { __buffer: value.toString('base64') };
  return value;
}

async function runMigration(sourceDb, targetDb, { batchSize, verifyOnly }) {
  const source = sourceDb.collection('transactions');
  const target = targetDb.collection('transactions');
  const sourceCountBefore = await source.countDocuments({});
  const targetCountBefore = await target.countDocuments({});
  const sourceStats = await sourceDb.stats().catch(() => null);
  const sourceIndexes = await source.indexes().catch(() => []);
  const migrationStartedAt = new Date();

  let copied = 0;
  let missing = 0;
  let mismatched = 0;
  let sourceSeen = 0;
  let lastSourceId = null;
  const cursor = source.find({}).sort({ _id: 1 }).batchSize(batchSize);
  let batch = [];

  async function handleBatch(docs) {
    if (!docs.length) return;
    if (!verifyOnly) {
      const operations = docs.map((doc) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $setOnInsert: doc },
          upsert: true,
        },
      }));
      await target.bulkWrite(operations, { ordered: false });
      copied += docs.length;
    }

    const found = await target.find({ _id: { $in: docs.map((doc) => doc._id) } }).toArray();
    const byId = new Map(found.map((doc) => [String(doc._id), doc]));
    for (const doc of docs) {
      const destination = byId.get(String(doc._id));
      if (!destination) missing += 1;
      else if (JSON.stringify(stable(doc)) !== JSON.stringify(stable(destination))) mismatched += 1;
    }
  }

  for await (const doc of cursor) {
    sourceSeen += 1;
    lastSourceId = doc._id;
    batch.push(doc);
    if (batch.length >= batchSize) {
      await handleBatch(batch);
      batch = [];
    }
  }
  if (batch.length) await handleBatch(batch);

  const sourceCountAfter = await source.countDocuments({});
  const targetCountAfter = await target.countDocuments({});
  const postCutoverWrites = await source.countDocuments({ createdAt: { $gte: migrationStartedAt } }).catch(() => null);
  const sourceStable = sourceCountBefore === sourceCountAfter && sourceSeen === sourceCountAfter;
  const verified = sourceStable &&
    missing === 0 &&
    mismatched === 0 &&
    targetCountAfter >= sourceCountAfter &&
    sourceIndexes.length > 0 &&
    postCutoverWrites === 0;

  const targetStats = await targetDb.stats().catch(() => null);
  return {
    migration: 'transactions-v1-readonly',
    mode: verifyOnly ? 'verify-only' : 'copy-and-verify',
    source: {
      countBefore: sourceCountBefore,
      countAfter: sourceCountAfter,
      storageSize: sourceStats?.storageSize ?? null,
      lastIdScanned: lastSourceId == null ? null : String(lastSourceId),
    },
    target: {
      countBefore: targetCountBefore,
      countAfter: targetCountAfter,
      storageSize: targetStats?.storageSize ?? null,
    },
    copied,
    missing,
    mismatched,
    sourceStable,
    postCutoverWrites,
    verified,
    checkedAt: new Date().toISOString(),
    sourceDeletionPerformed: false,
  };
}

(async () => {
  let exitCode = 0;
  let sourceClient;
  let targetClient;
  try {
    if (String(process.env.DB_TWO_ENABLED || '').toLowerCase() !== 'true') {
      throw new Error('Refusing migration: set DB_TWO_ENABLED=true.');
    }
    if (!process.env.MONGO_URI || !process.env.MONGO_URI_2 || !process.env.DB_TWO_NAME) {
      throw new Error('Missing MONGO_URI, MONGO_URI_2 or DB_TWO_NAME.');
    }
    const args = parseArgs(process.argv.slice(2));
    sourceClient = new MongoClient(process.env.MONGO_URI, { maxPoolSize: 5, minPoolSize: 0, retryWrites: true });
    targetClient = new MongoClient(process.env.MONGO_URI_2, { maxPoolSize: 5, minPoolSize: 0, retryWrites: true });
    await Promise.all([sourceClient.connect(), targetClient.connect()]);
    const sourceDb = sourceClient.db(process.env.DB_NAME || 'bika_slot');
    const targetDb = targetClient.db(process.env.DB_TWO_NAME);
    await Promise.all([sourceDb.command({ ping: 1 }), targetDb.command({ ping: 1 })]);
    console.log('Starting DB1(read-only) -> DB2 transaction history migration.');
    console.log('DB1 source documents will not be updated or deleted.');
    const report = await runMigration(sourceDb, targetDb, args);
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
    await Promise.all([
      sourceClient?.close().catch(() => {}),
      targetClient?.close().catch(() => {}),
    ]);
    process.exitCode = exitCode;
  }
})();
