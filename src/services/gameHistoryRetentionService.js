'use strict';

const { getDb, getTransactionHistoryDb, safeCreateIndex } = require('../config/database');

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_SECONDS = RETENTION_MS / 1000;
const BATCH_SIZE = 500;

async function ensureIndexes() {
  const db1 = getDb();
  const db2 = await getTransactionHistoryDb();

  // Use stable index names per collection; keep the permanent transaction
  // ledger and journal outside automatic retention.
  await safeCreateIndex(db1.collection('daily_tournaments'), { createdAt: 1 }, {
    expireAfterSeconds: RETENTION_SECONDS,
    name: 'ttl_createdAt_7d',
  });
  await safeCreateIndex(db2.collection('web_game_history'), { createdAt: 1 }, {
    expireAfterSeconds: RETENTION_SECONDS,
    name: 'ttl_createdAt_7d',
  });
  await safeCreateIndex(db1.collection('two_d_events'), { status: 1, resultAt: 1 }, {
    name: 'two_d_result_retention',
  });
  await safeCreateIndex(db1.collection('auctions'), { status: 1, settledAt: 1 }, {
    name: 'auction_settled_retention',
  });
  await safeCreateIndex(db1.collection('sports_events'), { status: 1, settledAt: 1 }, {
    name: 'sports_settled_retention',
  });
  await safeCreateIndex(db1.collection('two_d_bets'), { eventId: 1 }, {
    name: 'two_d_bets_event_retention',
  });
  await safeCreateIndex(db1.collection('two_d_positions'), { eventId: 1 }, {
    name: 'two_d_positions_event_retention',
  });
  await safeCreateIndex(db1.collection('auction_bids'), { auctionId: 1 }, {
    name: 'auction_bids_retention',
  });
  await safeCreateIndex(db1.collection('sports_bets'), { eventId: 1, status: 1 }, {
    name: 'sports_bets_retention',
  });
}

async function deleteRowsInBatches(col, filter) {
  let deleted = 0;
  while (true) {
    const rows = await col.find(filter, { projection: { _id: 1 } }).limit(BATCH_SIZE).toArray();
    if (!rows.length) break;
    const result = await col.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
    deleted += Number(result.deletedCount || 0);
    if (rows.length < BATCH_SIZE) break;
  }
  return deleted;
}

async function cleanupExpiredGameHistory({ now = new Date(), dryRun = false } = {}) {
  const db1 = getDb();
  const db2 = await getTransactionHistoryDb();
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  const report = {
    retentionDays: 7,
    cutoff: cutoff.toISOString(),
    dryRun,
    db1: {},
    db2: {},
    protected: {
      db1: ['users', 'treasury', 'config', 'two_d_offdates'],
      db2: ['transactions', '_transaction_journal', '_transaction_key_reservations'],
    },
  };

  async function cleanupParents({ parentName, childName, parentFilter, childFilterForIds, idField = '_id', reportKey, keepChildStatuses = null }) {
    let parentsDeleted = 0;
    let childrenDeleted = 0;
    let rowsSeen = 0;
    while (true) {
      const rows = await db1.collection(parentName).find(parentFilter, { projection: { _id: 1, [idField]: 1 } })
        .sort({ _id: 1 }).limit(BATCH_SIZE).toArray();
      if (!rows.length) break;
      rowsSeen += rows.length;
      if (dryRun) break;

      const ids = rows.map((row) => row[idField]).filter((value) => value != null);
      if (ids.length) {
        const childFilter = childFilterForIds(ids);
        childrenDeleted += await deleteRowsInBatches(db1.collection(childName), childFilter);
      }
      const deleted = await db1.collection(parentName).deleteMany({
        _id: { $in: rows.map((row) => row._id) },
        ...parentFilter,
      });
      parentsDeleted += Number(deleted.deletedCount || 0);
      if (rows.length < BATCH_SIZE) break;
    }
    report.db1[reportKey] = {
      matchedAtStart: rowsSeen,
      deleted: parentsDeleted,
      remainingExpired: await db1.collection(parentName).countDocuments(parentFilter),
    };
    report.db1[childName] = { deleted: childrenDeleted };
    return { parentsDeleted, childrenDeleted };
  }

  // Only settled/result records older than seven days are removed. Balances,
  // treasury, off-date config, and permanent DB2 transaction journals are not.
  await cleanupParents({
    parentName: 'two_d_events',
    childName: 'two_d_bets',
    parentFilter: { status: 'result', resultAt: { $type: 'date', $lte: cutoff } },
    childFilterForIds: (ids) => ({ eventId: { $in: ids } }),
    idField: 'eventId',
    reportKey: 'two_d_events',
  }).then(async () => {
    // The 2D positions share eventId and must be cleaned with the same parent IDs.
    const oldEventIds = await db1.collection('two_d_events').find(
      { status: 'result', resultAt: { $type: 'date', $lte: cutoff } },
      { projection: { eventId: 1 } },
    ).limit(BATCH_SIZE).toArray().then((rows) => rows.map((row) => row.eventId).filter(Boolean));
    if (!dryRun && oldEventIds.length) {
      report.db1.two_d_positions = { deleted: await deleteRowsInBatches(db1.collection('two_d_positions'), { eventId: { $in: oldEventIds } }) };
    } else {
      report.db1.two_d_positions = { deleted: 0 };
    }
  });

  await cleanupParents({
    parentName: 'auctions',
    childName: 'auction_bids',
    parentFilter: { status: 'closed', settledAt: { $type: 'date', $lte: cutoff } },
    childFilterForIds: (ids) => ({ auctionId: { $in: ids } }),
    idField: 'auctionId',
    reportKey: 'auctions',
  });

  await cleanupParents({
    parentName: 'sports_events',
    childName: 'sports_bets',
    parentFilter: { status: 'settled', settledAt: { $type: 'date', $lte: cutoff } },
    childFilterForIds: (ids) => ({
      eventId: { $in: ids },
      status: { $in: ['won', 'lost'] },
    }),
    idField: '_id',
    reportKey: 'sports_events',
  });

  const tournamentFilter = { createdAt: { $type: 'date', $lte: cutoff } };
  const tournaments = db1.collection('daily_tournaments');
  if (dryRun) {
    report.db1.daily_tournaments = { matched: await tournaments.countDocuments(tournamentFilter), deleted: 0 };
  } else {
    const deleted = await deleteRowsInBatches(tournaments, tournamentFilter);
    report.db1.daily_tournaments = { matched: deleted, deleted, remainingExpired: await tournaments.countDocuments(tournamentFilter) };
  }

  const webHistory = db2.collection('web_game_history');
  const webFilter = { createdAt: { $type: 'date', $lte: cutoff } };
  if (dryRun) {
    report.db2.web_game_history = { matched: await webHistory.countDocuments(webFilter), deleted: 0 };
  } else {
    const deleted = await deleteRowsInBatches(webHistory, webFilter);
    report.db2.web_game_history = { matched: deleted, deleted, remainingExpired: await webHistory.countDocuments(webFilter) };
  }
  return report;
}

module.exports = { RETENTION_MS, ensureIndexes, cleanupExpiredGameHistory };
