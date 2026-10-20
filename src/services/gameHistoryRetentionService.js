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

  // 2D history: remove only records attached to completed results over 7 days old.
  let twoD = { events: 0, bets: 0, positions: 0 };
  while (true) {
    const rows = await db1.collection('two_d_events').find(
      { status: 'result', resultAt: { $lte: cutoff } },
      { projection: { _id: 1, eventId: 1 } },
    ).limit(BATCH_SIZE).toArray();
    if (!rows.length) break;
    if (dryRun) { twoD.events += rows.length; break; }
    const ids = rows.map((row) => row.eventId).filter(Boolean);
    if (ids.length) {
      twoD.bets += await deleteRowsInBatches(db1.collection('two_d_bets'), { eventId: { $in: ids } });
      twoD.positions += await deleteRowsInBatches(db1.collection('two_d_positions'), { eventId: { $in: ids } });
    }
    const removed = await db1.collection('two_d_events').deleteMany({
      _id: { $in: rows.map((row) => row._id) },
      status: 'result',
      resultAt: { $lte: cutoff },
    });
    twoD.events += Number(removed.deletedCount || 0);
    if (rows.length < BATCH_SIZE) break;
  }
  report.db1.two_d_events = {
    remainingExpired: await db1.collection('two_d_events').countDocuments({ status: 'result', resultAt: { $lte: cutoff } }),
    deleted: twoD.events,
  };
  report.db1.two_d_bets = { deleted: twoD.bets };
  report.db1.two_d_positions = { deleted: twoD.positions };

  // Auction history is removable only after closed/settled, seven-day-old status.
  let auction = { events: 0, bids: 0 };
  while (true) {
    const rows = await db1.collection('auctions').find(
      { status: 'closed', settledAt: { $lte: cutoff } },
      { projection: { _id: 1, auctionId: 1 } },
    ).limit(BATCH_SIZE).toArray();
    if (!rows.length) break;
    if (dryRun) { auction.events += rows.length; break; }
    const ids = rows.map((row) => row.auctionId).filter(Boolean);
    if (ids.length) auction.bids += await deleteRowsInBatches(db1.collection('auction_bids'), { auctionId: { $in: ids } });
    const removed = await db1.collection('auctions').deleteMany({
      _id: { $in: rows.map((row) => row._id) },
      status: 'closed',
      settledAt: { $lte: cutoff },
    });
    auction.events += Number(removed.deletedCount || 0);
    if (rows.length < BATCH_SIZE) break;
  }
  report.db1.auctions = {
    remainingExpired: await db1.collection('auctions').countDocuments({ status: 'closed', settledAt: { $lte: cutoff } }),
    deleted: auction.events,
  };
  report.db1.auction_bids = { deleted: auction.bids };

  // Event/sports history expires only when the parent event is fully settled.
  let sports = { events: 0, bets: 0 };
  while (true) {
    const rows = await db1.collection('sports_events').find(
      { status: 'settled', settledAt: { $lte: cutoff } },
      { projection: { _id: 1 } },
    ).limit(BATCH_SIZE).toArray();
    if (!rows.length) break;
    if (dryRun) { sports.events += rows.length; break; }
    const ids = rows.map((row) => row._id);
    sports.bets += await deleteRowsInBatches(db1.collection('sports_bets'), {
      eventId: { $in: ids },
      status: { $in: ['won', 'lost'] },
    });
    const removed = await db1.collection('sports_events').deleteMany({
      _id: { $in: ids },
      status: 'settled',
      settledAt: { $lte: cutoff },
    });
    sports.events += Number(removed.deletedCount || 0);
    if (rows.length < BATCH_SIZE) break;
  }
  report.db1.sports_events = {
    remainingExpired: await db1.collection('sports_events').countDocuments({ status: 'settled', settledAt: { $lte: cutoff } }),
    deleted: sports.events,
  };
  report.db1.sports_bets = { deleted: sports.bets };

  const tournaments = db1.collection('daily_tournaments');
  const tournamentFilter = { createdAt: { $lte: cutoff } };
  if (dryRun) report.db1.daily_tournaments = { matched: await tournaments.countDocuments(tournamentFilter), deleted: 0 };
  else {
    const deleted = await deleteRowsInBatches(tournaments, tournamentFilter);
    report.db1.daily_tournaments = { matched: deleted, deleted };
  }

  const webHistory = db2.collection('web_game_history');
  const webFilter = { createdAt: { $lte: cutoff } };
  if (dryRun) report.db2.web_game_history = { matched: await webHistory.countDocuments(webFilter), deleted: 0 };
  else {
    const deleted = await deleteRowsInBatches(webHistory, webFilter);
    report.db2.web_game_history = { matched: deleted, deleted };
  }

  return report;
}

module.exports = { RETENTION_MS, ensureIndexes, cleanupExpiredGameHistory };
