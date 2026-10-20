'use strict';

require('dotenv').config();
const { MongoClient } = require('mongodb');

(async () => {
  let client1;
  let client2;
  try {
    if (String(process.env.DB_TWO_ENABLED || '').toLowerCase() !== 'true') {
      throw new Error('Set DB_TWO_ENABLED=true before running history cleanup.');
    }
    if (!process.env.MONGO_URI || !process.env.MONGO_URI_2 || !process.env.DB_TWO_NAME) {
      throw new Error('Missing MONGO_URI, MONGO_URI_2 or DB_TWO_NAME.');
    }
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    if (args.some((arg) => arg !== '--dry-run')) throw new Error('Supported option: --dry-run');

    client1 = new MongoClient(process.env.MONGO_URI, { maxPoolSize: 5, minPoolSize: 0, retryWrites: true });
    client2 = new MongoClient(process.env.MONGO_URI_2, { maxPoolSize: 5, minPoolSize: 0, retryWrites: true });
    await Promise.all([client1.connect(), client2.connect()]);
    const db1 = client1.db(process.env.DB_NAME || 'bika_slot');
    const db2 = client2.db(process.env.DB_TWO_NAME);
    await Promise.all([db1.command({ ping: 1 }), db2.command({ ping: 1 })]);
    if (db1.databaseName === db2.databaseName && process.env.MONGO_URI === process.env.MONGO_URI_2) {
      throw new Error('DB1 and DB2 resolve to the same database; refusing cleanup.');
    }

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const report = {
      mode: dryRun ? 'dry-run' : 'cleanup',
      retentionDays: 7,
      cutoff: cutoff.toISOString(),
      db1: {},
      db2: {},
      protected: ['users', 'treasury', 'config', 'two_d_offdates', 'transactions', '_transaction_journal', '_transaction_key_reservations'],
    };

    const twoD = await db1.collection('two_d_events').find({ status: 'result', resultAt: { $lte: cutoff } }, { projection: { _id: 1, eventId: 1 } }).limit(50000).toArray();
    const auctions = await db1.collection('auctions').find({ status: 'closed', settledAt: { $lte: cutoff } }, { projection: { _id: 1, auctionId: 1 } }).limit(50000).toArray();
    const sports = await db1.collection('sports_events').find({ status: 'settled', settledAt: { $lte: cutoff } }, { projection: { _id: 1 } }).limit(50000).toArray();
    if ([twoD, auctions, sports].some((rows) => rows.length >= 50000)) throw new Error('Over 50,000 expired parent records; use the in-app batched cleanup.');

    const id2d = twoD.map((x) => x.eventId).filter(Boolean);
    const idAuction = auctions.map((x) => x.auctionId).filter(Boolean);
    const idSports = sports.map((x) => x._id);
    const filters = {
      two_d_bets: id2d.length ? { eventId: { $in: id2d } } : { _id: { $exists: false } },
      two_d_positions: id2d.length ? { eventId: { $in: id2d } } : { _id: { $exists: false } },
      auction_bids: idAuction.length ? { auctionId: { $in: idAuction } } : { _id: { $exists: false } },
      sports_bets: idSports.length ? { eventId: { $in: idSports }, status: { $in: ['won', 'lost'] } } : { _id: { $exists: false } },
      daily_tournaments: { createdAt: { $lte: cutoff } },
    };
    for (const [name, filter] of Object.entries(filters)) {
      const col = db1.collection(name);
      const matched = await col.countDocuments(filter);
      report.db1[name] = { matched, deleted: 0 };
      if (!dryRun && matched) {
        if (matched > 50000) throw new Error(name + ' has more than 50,000 rows; use the in-app batched cleanup.');
        const rows = await col.find(filter, { projection: { _id: 1 } }).toArray();
        const removed = await col.deleteMany({ _id: { $in: rows.map((x) => x._id) } });
        report.db1[name].deleted = Number(removed.deletedCount || 0);
      }
    }

    const parents = [
      ['two_d_events', { _id: { $in: twoD.map((x) => x._id) }, status: 'result', resultAt: { $lte: cutoff } }],
      ['auctions', { _id: { $in: auctions.map((x) => x._id) }, status: 'closed', settledAt: { $lte: cutoff } }],
      ['sports_events', { _id: { $in: sports.map((x) => x._id) }, status: 'settled', settledAt: { $lte: cutoff } }],
    ];
    for (const [name, filter] of parents) {
      const matched = await db1.collection(name).countDocuments(filter);
      report.db1[name] = { matched, deleted: 0 };
      if (!dryRun && matched) {
        const removed = await db1.collection(name).deleteMany(filter);
        report.db1[name].deleted = Number(removed.deletedCount || 0);
      }
    }

    const history = db2.collection('web_game_history');
    const historyFilter = { createdAt: { $lte: cutoff } };
    const historyMatched = await history.countDocuments(historyFilter);
    report.db2.web_game_history = { matched: historyMatched, deleted: 0 };
    if (!dryRun && historyMatched) {
      if (historyMatched > 50000) throw new Error('web_game_history has more than 50,000 rows; use the in-app batched cleanup.');
      const rows = await history.find(historyFilter, { projection: { _id: 1 } }).toArray();
      const removed = await history.deleteMany({ _id: { $in: rows.map((x) => x._id) } });
      report.db2.web_game_history.deleted = Number(removed.deletedCount || 0);
    }

    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('GAME_HISTORY_CLEANUP_FAILED:', err?.stack || err);
    process.exitCode = 1;
  } finally {
    await Promise.all([client1?.close().catch(() => {}), client2?.close().catch(() => {})]);
  }
})();
