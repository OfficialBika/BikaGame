import { db } from 'sdk';
import {
  and, eq, inArray, lt, ne,
} from 'sdk/db';
import {
  auctions, auctionBids, dailyTournaments, gameHistory, gameSessions,
  orders, paymentEvents, settings, sportsBets, sportsEvents,
  transactions, twoDBets, twoDEvents, twoDPositions, webGameHistory,
} from '../schema.js';

const RETENTION_MS = 3 * 24 * 60 * 60 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CHECKPOINT_KEY = '__serverless_v2_retention__';
const BATCH_LIMIT = 200;
const TERMINAL_ORDER_STATUSES = [
  'COMPLETED', 'CANCELLED', 'EXPIRED', 'FAILED', 'REJECTED', 'DELIVERED',
];
const TERMINAL_SESSION_STATUSES = [
  'settled', 'lost', 'won', 'closed', 'cancelled', 'expired',
];

async function removeOldSettledTwoD(cutoff) {
  const expired = await db.select({ eventId: twoDEvents.eventId })
    .from(twoDEvents)
    .where(and(eq(twoDEvents.status, 'result'), lt(twoDEvents.resultAt, cutoff)))
    .limit(BATCH_LIMIT)
    .all();
  const ids = [...new Set(expired.map((row) => String(row.eventId || '')).filter(Boolean))];
  if (!ids.length) return { events: 0, bets: 0, positions: 0 };
  const bets = await db.delete(twoDBets).where(inArray(twoDBets.eventId, ids)).run();
  const positions = await db.delete(twoDPositions).where(inArray(twoDPositions.eventId, ids)).run();
  const events = await db.delete(twoDEvents)
    .where(and(inArray(twoDEvents.eventId, ids), eq(twoDEvents.status, 'result'), lt(twoDEvents.resultAt, cutoff)))
    .run();
  return {
    events: Number(events?.rowsAffected || 0),
    bets: Number(bets?.rowsAffected || 0),
    positions: Number(positions?.rowsAffected || 0),
  };
}

async function removeOldSettledSports(cutoff) {
  const expired = await db.select({ id: sportsEvents.id })
    .from(sportsEvents)
    .where(and(eq(sportsEvents.status, 'settled'), lt(sportsEvents.settledAt, cutoff)))
    .limit(BATCH_LIMIT)
    .all();
  const ids = [...new Set(expired.map((row) => String(row.id || '')).filter(Boolean))];
  if (!ids.length) return { events: 0, bets: 0 };
  const bets = await db.delete(sportsBets).where(inArray(sportsBets.eventId, ids)).run();
  const events = await db.delete(sportsEvents)
    .where(and(inArray(sportsEvents.id, ids), eq(sportsEvents.status, 'settled'), lt(sportsEvents.settledAt, cutoff)))
    .run();
  return {
    events: Number(events?.rowsAffected || 0),
    bets: Number(bets?.rowsAffected || 0),
  };
}

async function removeExpiredAuctions(now) {
  const expired = await db.select({ auctionId: auctions.auctionId })
    .from(auctions)
    .where(and(eq(auctions.status, 'closed'), lt(auctions.historyExpiresAt, now)))
    .limit(BATCH_LIMIT)
    .all();
  const ids = [...new Set(expired.map((row) => String(row.auctionId || '')).filter(Boolean))];
  if (!ids.length) return { auctions: 0, bids: 0 };
  const bids = await db.delete(auctionBids).where(inArray(auctionBids.auctionId, ids)).run();
  const rows = await db.delete(auctions)
    .where(and(inArray(auctions.auctionId, ids), eq(auctions.status, 'closed'), lt(auctions.historyExpiresAt, now)))
    .run();
  return {
    auctions: Number(rows?.rowsAffected || 0),
    bids: Number(bids?.rowsAffected || 0),
  };
}

async function cleanupExpiredRows(now, cutoff) {
  const removed = {};
  removed.gameHistory = Number((await db.delete(gameHistory)
    .where(lt(gameHistory.createdAt, cutoff)).run())?.rowsAffected || 0);
  removed.webGameHistory = Number((await db.delete(webGameHistory)
    .where(lt(webGameHistory.createdAt, cutoff)).run())?.rowsAffected || 0);
  removed.transactions = Number((await db.delete(transactions)
    .where(lt(transactions.createdAt, cutoff)).run())?.rowsAffected || 0);
  removed.terminalOrders = Number((await db.delete(orders)
    .where(and(lt(orders.createdAt, cutoff), inArray(orders.status, TERMINAL_ORDER_STATUSES))).run())?.rowsAffected || 0);
  removed.terminalSessions = Number((await db.delete(gameSessions)
    .where(and(lt(gameSessions.updatedAt, cutoff), inArray(gameSessions.status, TERMINAL_SESSION_STATUSES))).run())?.rowsAffected || 0);
  removed.dailyTournaments = Number((await db.delete(dailyTournaments)
    .where(lt(dailyTournaments.createdAt, cutoff)).run())?.rowsAffected || 0);

  // Preserve payment charge IDs as compact replay-protection markers. Remove
  // verbose payloads for old terminal payments, but never touch pending events.
  const paymentScrub = await db.update(paymentEvents)
    .set({ payload: null, invoicePayload: null, updatedAt: now })
    .where(and(lt(paymentEvents.createdAt, cutoff), ne(paymentEvents.status, 'pending')))
    .run();
  removed.paymentPayloadsScrubbed = Number(paymentScrub?.rowsAffected || 0);

  removed.twoD = await removeOldSettledTwoD(cutoff);
  removed.sports = await removeOldSettledSports(cutoff);
  removed.auctions = await removeExpiredAuctions(now);
  return removed;
}

// Serverless has no always-on timer. Call this cheaply at handler entry; it runs
// cleanup at most once per interval, uses bounded child-table batches, and never
// deletes balances, users, treasury, settings, inventory, pending bets or pending orders.
export async function maybeRunRetention() {
  const now = new Date();
  try {
    const checkpoint = await db.select().from(settings).where(eq(settings.key, CHECKPOINT_KEY)).get();
    const lastAttempt = checkpoint?.updatedAt ? new Date(checkpoint.updatedAt).getTime() : 0;
    if (Number.isFinite(lastAttempt) && now.getTime() - lastAttempt < CHECK_INTERVAL_MS) {
      return { ok: true, ran: false };
    }

    await db.insert(settings).values({
      key: CHECKPOINT_KEY,
      value: { state: 'running', startedAt: now.toISOString() },
      updatedAt: now,
    }).onConflictDoUpdate({
      target: settings.key,
      set: { value: { state: 'running', startedAt: now.toISOString() }, updatedAt: now },
    }).run();

    const removed = await cleanupExpiredRows(now, new Date(now.getTime() - RETENTION_MS));
    const finished = new Date();
    await db.update(settings).set({
      value: { state: 'ok', finishedAt: finished.toISOString(), removed },
      updatedAt: finished,
    }).where(eq(settings.key, CHECKPOINT_KEY)).run();
    console.info('SERVERLESS_V2_RETENTION_COMPLETE', removed);
    return { ok: true, ran: true, removed };
  } catch (error) {
    console.error('SERVERLESS_V2_RETENTION_FAILED', String(error?.message || error));
    return { ok: false, ran: false, error: String(error?.message || error) };
  }
}
