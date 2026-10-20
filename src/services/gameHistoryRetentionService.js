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
    // Select a fixed batch and delete by _id so the cursor progresses as rows
    // disappear. Do not stop on a full batch; repeat until no expired rows remain.
    const rows = await col.find(filter, { projection: { _id: 1 } })
      .sort({ _id: 1 }).limit(BATCH_SIZE).toArray();
    if (!rows.length) break;
    const result = await col.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
    const removed = Number(result.deletedCount || 0);
    deleted += removed;
    if (removed === 0) {
      throw new Error('RETENTION_BATCH_STALLED:' + String(col.collectionName || 'collection'));
    }
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

  async function cleanupLinkedHistory({ parentName, childName, parentFilter, parentIdField, childFilterForIds, extraChildCollections = [] }) {
    let matchedAtStart = 0;
    let parentsDeleted = 0;
    let childrenDeleted = 0;
    const childStats = {};
    let lastId;
    let hasLastId = false;

    while (true) {
      const filter = { ...parentFilter };
      if (hasLastId) filter._id = { $gt: lastId };
      const rows = await db1.collection(parentName).find(filter, {
        projection: { _id: 1, [parentIdField]: 1 },
      }).sort({ _id: 1 }).limit(BATCH_SIZE).toArray();
      if (!rows.length) break;

      matchedAtStart += rows.length;
      lastId = rows[rows.length - 1]._id;
      hasLastId = true;
      if (dryRun) {
        if (rows.length < BATCH_SIZE) break;
        continue;
      }

      const ids = rows.map((row) => row[parentIdField]).filter((id) => id != null);
      if (ids.length) {
        childrenDeleted += await deleteRowsInBatches(db1.collection(childName), childFilterForIds(ids));
        for (const extra of extraChildCollections) {
          const removed = await deleteRowsInBatches(db1.collection(extra.name), extra.filterForIds(ids));
          childStats[extra.name] = (childStats[extra.name] || 0) + removed;
        }
      }
      const removedParents = await db1.collection(parentName).deleteMany({
        _id: { $in: rows.map((row) => row._id) },
        ...parentFilter,
      });
      parentsDeleted += Number(removedParents.deletedCount || 0);
      if (rows.length < BATCH_SIZE) break;
    }

    report.db1[parentName] = {
      matchedAtStart,
      deleted: parentsDeleted,
      remainingExpired: await db1.collection(parentName).countDocuments(parentFilter),
    };
    report.db1[childName] = { deleted: childrenDeleted };
    for (const [name, deleted] of Object.entries(childStats)) report.db1[name] = { deleted };
  }

  // Completed 2D outcomes only. Keep today's/active/settling events and the
  // permanent transaction ledger untouched.
  await cleanupLinkedHistory({
    parentName: 'two_d_events',
    childName: 'two_d_bets',
    parentFilter: { status: 'result', resultAt: { $type: 'date', $lte: cutoff } },
    parentIdField: 'eventId',
    childFilterForIds: (ids) => ({ eventId: { $in: ids } }),
    extraChildCollections: [
      { name: 'two_d_positions', filterForIds: (ids) => ({ eventId: { $in: ids } }) },
    ],
  });

  // Closed auctions remain visible for seven days, then the parent and all
  // associated bids are removed in small batches.
  await cleanupLinkedHistory({
    parentName: 'auctions',
    childName: 'auction_bids',
    parentFilter: { status: 'closed', settledAt: { $type: 'date', $lte: cutoff } },
    parentIdField: 'auctionId',
    childFilterForIds: (ids) => ({ auctionId: { $in: ids } }),
  });

  // Only fully settled sports bets are eligible; pending/unsettled bets remain.
  await cleanupLinkedHistory({
    parentName: 'sports_events',
    childName: 'sports_bets',
    parentFilter: { status: 'settled', settledAt: { $type: 'date', $lte: cutoff } },
    parentIdField: '_id',
    childFilterForIds: (ids) => ({ eventId: { $in: ids }, status: { $in: ['won', 'lost'] } }),
  });

  const tournamentFilter = { createdAt: { $type: 'date', $lte: cutoff } };
  const tournaments = db1.collection('daily_tournaments');
  if (dryRun) {
    report.db1.daily_tournaments = { matched: await tournaments.countDocuments(tournamentFilter), deleted: 0 };
  } else {
    const deleted = await deleteRowsInBatches(tournaments, tournamentFilter);
    report.db1.daily_tournaments = {
      matched: deleted,
      deleted,
      remainingExpired: await tournaments.countDocuments(tournamentFilter),
    };
  }

  const webHistory = db2.collection('web_game_history');
  const webFilter = { createdAt: { $type: 'date', $lte: cutoff } };
  if (dryRun) {
    report.db2.web_game_history = { matched: await webHistory.countDocuments(webFilter), deleted: 0 };
  } else {
    const deleted = await deleteRowsInBatches(webHistory, webFilter);
    report.db2.web_game_history = {
      matched: deleted,
      deleted,
      remainingExpired: await webHistory.countDocuments(webFilter),
    };
  }
  return report;
}

module.exports = { RETENTION_MS, ensureIndexes, cleanupExpiredGameHistory };
