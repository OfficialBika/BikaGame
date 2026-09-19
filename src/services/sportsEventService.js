'use strict';

const { col, withMaybeTx } = require('../config/database');
const { ensureUser, treasuryPayToUser } = require('./economyService');
const { logTx } = require('./transactionService');
const { env } = require('../config/env');

const events = () => col('sports_events');
const bets = () => col('sports_bets');

function normalizeAlias(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function parseSetEvent(text) {
  const lines = String(text || '').replace(/\r/g, '').trim().split('\n').map(s => s.trim()).filter(Boolean);
  if (!/^\/setevent(?:@[\w_]+)?\s+/i.test(lines[0] || '') || lines.length < 3) return null;
  const title = lines[0].replace(/^\/setevent(?:@[\w_]+)?\s+/i, '').trim();
  const odds = lines[1].split('|').map(s => Number(String(s).replace(/[×xX]/g, '').trim()));
  const aliases = lines[2].split('|').map(normalizeAlias);
  const teams = title.split(/\s+(?:vs\.?|v\.?|versus)\s+/i).map(s => s.trim());
  if (teams.length !== 2 || teams.some(Boolean) === false) return null;
  if (odds.length !== 2 || aliases.length !== 2 || odds.some(n => !Number.isFinite(n) || n <= 1)) return null;
  if (!aliases[0] || !aliases[1] || aliases[0] === aliases[1]) return null;
  return { title, teams: [{ name: teams[0], alias: aliases[0], odd: odds[0] }, { name: teams[1], alias: aliases[1], odd: odds[1] }] };
}

function parseBet(text) {
  const m = String(text || '').trim().match(/^\.bet(?:@[\w_]+)?\s+([a-z0-9_-]+)\s+([\d,]+(?:\.\d+)?)\s*$/i);
  if (!m) return null;
  return { alias: normalizeAlias(m[1]), amount: Math.floor(Number(m[2].replace(/,/g, ''))) };
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.TZ || 'Asia/Yangon', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(date).replace(',', '');
}
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }

function getReplyRoot(message) {
  const r = message?.reply_to_message;
  return r || null;
}

async function findActiveEventByThread(chatId, rootMessageId) {
  return events().findOne({ commentChatId: String(chatId), $or: [{ threadRootMessageId: Number(rootMessageId) }, { announcementMessageId: Number(rootMessageId) }], status: { $in: ['open', 'stopped'] } });
}

async function createEvent(data) {
  const now = new Date();
  const doc = { ...data, status: 'open', totalBet: 0, totalBetBal: 0, totalWinBal: 0, createdAt: now, updatedAt: now, createdBy: Number(env.OWNER_ID) };
  const result = await events().insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function placeBet(event, ctx, alias, amount) {
  if (event.status !== 'open') throw new Error('BET_CLOSED');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('INVALID_AMOUNT');
  const team = event.teams.find(t => t.alias === alias);
  if (!team) throw new Error('INVALID_TEAM');

  await ensureUser(ctx.from);
  const userId = Number(ctx.from.id);
  const now = new Date();

  return withMaybeTx(async (session) => {
    const opts = session ? { session } : {};
    const existing = await bets().findOne({ eventId: event._id, userId }, opts);
    if (existing) throw new Error('DUPLICATE_BET');

    const user = await col('users').findOneAndUpdate(
      { userId: { $in: [String(userId), userId] }, balance: { $gte: amount } },
      { $inc: { balance: -amount, totalLost: amount }, $set: { updatedAt: now } },
      { ...opts, returnDocument: 'after' }
    );
    if (!user) throw new Error('USER_INSUFFICIENT');

    await col('config').updateOne({ key: 'treasury' }, { $inc: { ownerBalance: amount }, $set: { updatedAt: now } }, opts);

    const betDoc = {
      eventId: event._id, userId,
      username: ctx.from.username ? String(ctx.from.username).toLowerCase() : null,
      firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null,
      amount, alias, teamName: team.name, odd: team.odd,
      potentialWin: Math.floor(amount * team.odd), status: 'active', createdAt: now
    };
    await bets().insertOne(betDoc, opts);
    await events().updateOne({ _id: event._id, status: 'open' }, { $inc: { totalBet: 1, totalBetBal: amount }, $set: { updatedAt: now } }, opts);
    await logTx({ type: 'sports_bet', fromUserId: userId, toUserId: 'TREASURY', amount, meta: { eventId: String(event._id), alias, odd: team.odd } }, opts);
    return betDoc;
  });
}

async function stopEvent(event) {
  await events().updateOne({ _id: event._id, status: 'open' }, { $set: { status: 'stopped', stoppedAt: new Date(), updatedAt: new Date() } });
}

async function settleEvent(event, winnerAlias, payoutFn) {
  if (event.status !== 'stopped') throw new Error('EVENT_NOT_STOPPED');
  const winner = event.teams.find(t => t.alias === winnerAlias);
  if (!winner) throw new Error('INVALID_WINNER');
  const allBets = await bets().find({ eventId: event._id }).sort({ potentialWin: -1, createdAt: 1 }).toArray();
  const winners = allBets.filter(b => b.alias === winnerAlias);
  const losers = allBets.filter(b => b.alias !== winnerAlias);
  const totalWinBal = winners.reduce((s, b) => s + b.potentialWin, 0);
  const treasury = await col('config').findOne({ key: 'treasury' });
  if (Number(treasury?.ownerBalance || 0) < totalWinBal) throw new Error('TREASURY_INSUFFICIENT_FOR_SETTLEMENT');
  for (const bet of winners) {
    await payoutFn(bet.userId, bet.potentialWin, { type: 'sports_win', eventId: String(event._id), betId: String(bet._id), odd: bet.odd });
    await bets().updateOne({ _id: bet._id }, { $set: { status: 'won', settledAt: new Date(), payout: bet.potentialWin } });
  }
  if (losers.length) await bets().updateMany({ _id: { $in: losers.map(b => b._id) } }, { $set: { status: 'lost', settledAt: new Date(), payout: 0 } });
  await events().updateOne({ _id: event._id }, { $set: { status: 'settled', winnerAlias, winnerTeam: winner.name, settledAt: new Date(), totalWinBal, updatedAt: new Date() } });
  return { winner, winners, losers, allBets };
}

module.exports = { events, bets, normalizeAlias, parseSetEvent, parseBet, formatDate, fmt, getReplyRoot, findActiveEventByThread, createEvent, placeBet, stopEvent, settleEvent };
