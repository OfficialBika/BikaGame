'use strict';

const { col, getTransactionHistoryDb, safeCreateIndex } = require('../config/database');

const RETENTION_SECONDS = 7 * 24 * 60 * 60;
const RETENTION_MS = RETENTION_SECONDS * 1000;
const BATCH_SIZE = 500;
let running = false;

async function deleteInBatches(collection, filter) {
  let deleted = 0;
  while (true) {
    const rows = await collection.find(filter, { projection: { _id: 1 } })
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .toArray();
    if (!rows.length) break;
    const result = await collection.deleteMany({ _id: { $in: rows.map((row) => row._id) } });
    const count = Number(result.deletedCount || 0);
    if (!count) throw new Error('GAME_HISTORY_RETENTION_STALLED');
    deleted += count;
  }
  return deleted;
}

async function ensureIndexes() {
  // Only parent/history timestamps get TTL indexes. Child bet rows are removed
  // together with their completed parent so an active long-running event cannot
  // lose its bets merely because an individual bet is older than seven days.
  await safeCreateIndex(col('two_d_events'), { resultAt: 1 }, {
    expireAfterSeconds: RETENTION_SECONDS,
    name: 'ttl_resultAt_7d',
    partialFilterExpression: { resultAt: { $type: 'date' } },
  });
  await safeCreateIndex(col('auctions'), { settledAt: 1 }, {
    expireAfterSeconds: RETENTION_SECONDS,
    name: 'ttl_settledAt_7d',
    partialFilterExpression: { settledAt: { $type: 'date' } },
  });
  await safeCreateIndex(col('sports_events'), { settledAt: 1 }, {
    expireAfterSeconds: RETENTION_SECONDS,
    name: 'ttl_settledAt_7d',
    partialFilterExpression: { settledAt: { $type: 'date' } },
  });
  await safeCreateIndex(col('daily_tournaments'), { createdAt: 1 }, {
    expireAfterSeconds: RETENTION_SECONDS,
    name: 'ttl_createdAt_7d',
    partialFilterExpression: { createdAt: { $type: 'date' } },
  });

  // webBetHistoryService also creates this index on first write/read. Creating
  // it here makes retention deterministic immediately after startup.
  const db2 = await getTransactionHistoryDb();

  // DB2 stores user-facing web game history and the financial transaction ledger.
  // Keep financial transaction rows for seven days as requested; this is separate
  // from DB1's financial_idempotency keys, which remain permanent to guard retries.
  await safeCreateIndex(db2.collection('transactions'), { createdAt: 1 }, {
    expireAfterSeconds: RETENTION_SECONDS,
    name: 'ttl_transactions_createdAt_7d',
  });
  await safeCreateIndex(db2.collection('web_game_history'), { createdAt: 1 }, {
    expireAfterSeconds: RETENTION_SECONDS,
    name: 'ttl_createdAt_7d',
  });
}

async function cleanupExpiredGameHistory({ now = new Date() } = {}) {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;
  const cutoff = new Date(now.getTime() - RETENTION_MS);
  try {
    const report = { retentionDays: 7, cutoff: cutoff.toISOString(), deleted: {} };

    const old2d = await col('two_d_events').find(
      { resultAt: { $type: 'date', $lte: cutoff } },
      { projection: { eventId: 1 } },
    ).toArray();
    const twoDIds = old2d.map((row) => row.eventId).filter(Boolean);
    if (twoDIds.length) {
      report.deleted.two_d_bets = await deleteInBatches(col('two_d_bets'), { eventId: { $in: twoDIds } });
      report.deleted.two_d_positions = await deleteInBatches(col('two_d_positions'), { eventId: { $in: twoDIds } });
    }
    // The parent TTL index will remove expired events asynchronously; this
    // explicit cleanup removes children immediately and safely in batches.
    report.deleted.two_d_events = 0;

    const oldAuctions = await col('auctions').find(
      { settledAt: { $type: 'date', $lte: cutoff } },
      { projection: { auctionId: 1 } },
    ).toArray();
    const auctionIds = oldAuctions.map((row) => row.auctionId).filter(Boolean);
    if (auctionIds.length) report.deleted.auction_bids = await deleteInBatches(col('auction_bids'), { auctionId: { $in: auctionIds } });

    const oldSports = await col('sports_events').find(
      { settledAt: { $type: 'date', $lte: cutoff } },
      { projection: { _id: 1 } },
    ).toArray();
    const sportsIds = oldSports.map((row) => row._id).filter(Boolean);
    if (sportsIds.length) report.deleted.sports_bets = await deleteInBatches(col('sports_bets'), { eventId: { $in: sportsIds } });

    // DB2 transactions history expires via the TTL index above. Financial idempotency
    // keys remain in DB1 and are intentionally not deleted by this cleanup routine.
    return report;
  } finally {
    running = false;
  }
}

module.exports = { ensureIndexes, cleanupExpiredGameHistory };
