'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');

const MIB = 1024 * 1024;
const MB_DECIMAL = 1_000_000;

function mb(bytes, base = 'mib') {
  const value = Number(bytes || 0);
  return value / (base === 'mb' ? MB_DECIMAL : MIB);
}

function fmt(bytes, base = 'mib') {
  return mb(bytes, base).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseArgs(argv) {
  const args = { base: 'mib', details: false };
  for (const arg of argv) {
    if (arg === '--mb') args.base = 'mb';
    else if (arg === '--mib') args.base = 'mib';
    else if (arg === '--details') args.details = true;
    else if (arg === '--help') {
      console.log('Usage: node scripts/db-storage-report.js [--mib|--mb] [--details]');
      console.log('  --mib      Display MiB (1 MiB = 1,048,576 bytes; default)');
      console.log('  --mb       Display decimal MB (1 MB = 1,000,000 bytes)');
      console.log('  --details  Include per-collection sizes');
      process.exit(0);
    } else throw new Error('Unknown argument: ' + arg);
  }
  return args;
}

async function inspectDatabase(client, databaseName, label, args) {
  const database = client.db(databaseName);
  await database.command({ ping: 1 });
  const names = await database.listCollections({}, { nameOnly: true }).toArray();
  const rows = [];
  let documents = 0;
  let dataSize = 0;
  let storageSize = 0;
  let indexSize = 0;

  for (const item of names) {
    const collection = database.collection(item.name);
    let stats;
    try {
      stats = await database.command({ collStats: item.name });
    } catch (err) {
      throw new Error(label + '.' + item.name + ' stats failed: ' + (err?.message || err));
    }
    const count = Number(stats.count || 0);
    const data = Number(stats.size || stats.dataSize || 0);
    const storage = Number(stats.storageSize || 0);
    const indexes = Number(stats.totalIndexSize || 0);
    documents += count;
    dataSize += data;
    storageSize += storage;
    indexSize += indexes;
    if (args.details) rows.push({ name: item.name, count, data, storage, indexes });
  }

  console.log('=== ' + label + ' ===');
  console.log('Database          : ' + databaseName);
  console.log('Collections       : ' + names.length.toLocaleString('en-US'));
  console.log('Documents         : ' + documents.toLocaleString('en-US'));
  console.log('Data Size         : ' + fmt(dataSize, args.base) + ' ' + args.base.toUpperCase());
  console.log('Storage Size      : ' + fmt(storageSize, args.base) + ' ' + args.base.toUpperCase());
  console.log('Index Size        : ' + fmt(indexSize, args.base) + ' ' + args.base.toUpperCase());
  console.log('Storage + Indexes : ' + fmt(storageSize + indexSize, args.base) + ' ' + args.base.toUpperCase());

  if (args.details) {
    console.log('-- Per collection --');
    for (const row of rows.sort((a, b) => (b.storage + b.indexes) - (a.storage + a.indexes))) {
      console.log(
        row.name.padEnd(32) +
        ' docs=' + row.count.toLocaleString('en-US').padStart(10) +
        ' data=' + fmt(row.data, args.base).padStart(12) +
        ' storage=' + fmt(row.storage, args.base).padStart(12) +
        ' indexes=' + fmt(row.indexes, args.base).padStart(12) +
        ' ' + args.base.toUpperCase()
      );
    }
  }

  return { databaseName, collections: names.length, documents, dataSize, storageSize, indexSize };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.MONGO_URI || !process.env.DB_NAME) {
    throw new Error('MONGO_URI and DB_NAME must be configured in .env');
  }
  const db2Enabled = String(process.env.DB_TWO_ENABLED || '').toLowerCase() === 'true';
  if (db2Enabled && (!process.env.MONGO_URI_2 || !process.env.DB_TWO_NAME)) {
    throw new Error('DB_TWO_ENABLED=true but MONGO_URI_2 or DB_TWO_NAME is missing');
  }

  const clients = [];
  try {
    const client1 = new MongoClient(process.env.MONGO_URI, { maxPoolSize: 2, minPoolSize: 0, readPreference: 'primaryPreferred' });
    clients.push(client1);
    await client1.connect();
    await inspectDatabase(client1, process.env.DB_NAME, 'DB1', args);

    if (db2Enabled) {
      const sameEndpoint = (() => {
        try {
          const one = new URL(process.env.MONGO_URI);
          const two = new URL(process.env.MONGO_URI_2);
          return one.protocol === two.protocol && one.host.toLowerCase() === two.host.toLowerCase() &&
            decodeURIComponent(one.username) === decodeURIComponent(two.username) &&
            decodeURIComponent(one.password) === decodeURIComponent(two.password);
        } catch (_) {
          return process.env.MONGO_URI === process.env.MONGO_URI_2;
        }
      })();
      const client2 = sameEndpoint ? client1 : new MongoClient(process.env.MONGO_URI_2, { maxPoolSize: 2, minPoolSize: 0, readPreference: 'primaryPreferred' });
      if (!sameEndpoint) {
        clients.push(client2);
        await client2.connect();
      }
      await inspectDatabase(client2, process.env.DB_TWO_NAME, 'DB2', args);
    } else {
      console.log('=== DB2 ===');
      console.log('Skipped: DB_TWO_ENABLED is not true.');
    }

    console.log('Filesystem usage is separate; use df -h / on the VPS for disk usage.');
  } finally {
    await Promise.all(clients.map((client) => client.close().catch(() => {})));
  }
}

main().catch((err) => {
  console.error('DB_STORAGE_REPORT_FAILED:', err?.stack || err);
  process.exitCode = 1;
});
