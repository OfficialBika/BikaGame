import { db, api, EndpointError } from 'sdk';
import { and, desc, eq } from 'sdk/db';
import { auctions, auctionBids, sportsEvents, sportsBets, users, settings } from '../schema.js';
import {
  ensureEconomy, ensureUser, recordLedgerOperation, settleMultiPayouts,
  getTransaction, credit, getSetting, setSetting,
} from './economy.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';

const now = () => new Date();
const id = (prefix) => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
const safeInt = (value, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
};
const text = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const normalizeAlias = (value) => text(value, 32).toLowerCase().replace(/[^a-z0-9_-]/g, '');

function ownerId() {
  const n = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function requireOwner(userId) {
  const expected = ownerId();
  if (!expected) throw new EndpointError('SERVERLESS_OWNER_TELEGRAM_ID သတ်မှတ်ထားခြင်းမရှိပါ။', { code: 'OWNER_NOT_CONFIGURED' });
  if (String(userId ?? '') !== String(expected)) throw new EndpointError('Owner only.', { code: 'OWNER_ONLY' });
}
function unwrapMessage(result) { return result?.result || result; }

export function parseSetEventText(value) {
  const lines = String(value || '').replace(/\r/g, '').trim().split('\n').map(x => x.trim()).filter(Boolean);
  const first = lines[0] || '';
  if (!/^\/setevent(?:@[\w_]+)?\s+/i.test(first) || lines.length < 3) return null;
  const title = first.replace(/^\/setevent(?:@[\w_]+)?\s+/i, '').trim();
  const names = title.split(/\s+(?:vs\.?|v\.?|versus)\s+/i).map(x => x.trim());
  const odds = lines[1].split('|').map(x => Number(x.replace(/[×xX]/g, '').trim()));
  const aliases = lines[2].split('|').map(normalizeAlias);
  if (names.length !== 2 || names.some(x => !x || x.length > 100)) return null;
  if (odds.length !== 2 || odds.some(x => !Number.isFinite(x) || x <= 1 || x > 100)) return null;
  if (aliases.length !== 2 || aliases.some(x => !x) || aliases[0] === aliases[1]) return null;
  return { title, teams: names.map((name, i) => ({ name, alias: aliases[i], odd: odds[i] })) };
}

export async function createSportsEvent({ chatId, rootMessageId, sourceChatId, sourceText, title, teams, createdBy }) {
  await ensureEconomy();
  requireOwner(createdBy);
  if (!chatId || !rootMessageId || !Array.isArray(teams) || teams.length !== 2) {
    throw new EndpointError('Event source reply မမှန်ပါ။', { code: 'SPORTS_EVENT_INVALID' });
  }
  const rows = await db.select().from(sportsEvents).where(eq(sportsEvents.commentChatId, Number(chatId))).all();
  const duplicate = rows.find(row => ['open', 'stopped'].includes(row.status) &&
    (Number(row.threadRootMessageId) === Number(rootMessageId) ||
      Number(row.data?.announcementMessageId) === Number(rootMessageId) ||
      (Array.isArray(row.threadMessageIds) && row.threadMessageIds.includes(Number(rootMessageId)))));
  if (duplicate) throw new EndpointError('ဒီ thread မှာ active event ရှိပြီးသားပါ။', { code: 'SPORTS_EVENT_EXISTS' });
  const eventId = id('sports');
  const stamp = now();
  const data = { teams, sourceChatId: Number(sourceChatId || chatId), rootMessageId: Number(rootMessageId),
    sourceText: text(sourceText, 4000), totalBets: 0, totalBetBal: 0, totalWinBal: 0, createdBy: Number(createdBy) };
  await db.insert(sportsEvents).values({
    id: eventId, title: text(title, 200), status: 'open', result: null,
    commentChatId: Number(chatId), threadRootMessageId: Number(rootMessageId),
    threadMessageIds: [Number(rootMessageId)], data, createdAt: stamp, updatedAt: stamp,
  }).run();
  return db.select().from(sportsEvents).where(eq(sportsEvents.id, eventId)).get();
}

export async function findSportsEventForReply(chatId, replyMessage) {
  if (!replyMessage?.message_id || !chatId) return null;
  const rows = await db.select().from(sportsEvents).where(eq(sportsEvents.commentChatId, Number(chatId)))
    .orderBy(desc(sportsEvents.createdAt)).all();
  const replyId = Number(replyMessage.message_id);
  return rows.find(row => ['open', 'stopped'].includes(row.status) &&
    (Number(row.threadRootMessageId) === replyId ||
     Number(row.data?.announcementMessageId) === replyId ||
     (Array.isArray(row.threadMessageIds) && row.threadMessageIds.includes(replyId)))) || null;
}

export async function rememberSportsThreadMessage(eventId, messageId) {
  if (!eventId || !messageId) return;
  const event = await db.select().from(sportsEvents).where(eq(sportsEvents.id, String(eventId))).get();
  if (!event) return;
  const existing = Array.isArray(event.threadMessageIds) ? event.threadMessageIds : [];
  const ids = Array.from(new Set([...existing, Number(messageId)].filter(n => Number.isSafeInteger(n) && n > 0)));
  await db.update(sportsEvents).set({ threadMessageIds: ids, updatedAt: now() })
    .where(eq(sportsEvents.id, String(eventId))).run();
}

export async function placeSportsBet({ event, telegramUser, alias, amount, messageId }) {
  await ensureEconomy();
  const user = await ensureUser(telegramUser);
  if (!event || event.status !== 'open') throw new EndpointError('Sports betting ပိတ်ထားပါပြီ။', { code: 'SPORTS_EVENT_CLOSED' });
  const n = safeInt(amount, 1, 1000000000);
  if (!n) throw new EndpointError('Bet amount မမှန်ပါ။', { code: 'INVALID_AMOUNT' });
  const keyAlias = normalizeAlias(alias);
  const team = (event.data?.teams || []).find(t => normalizeAlias(t.alias) === keyAlias);
  if (!team) throw new EndpointError('Team alias မမှန်ပါ။', { code: 'SPORTS_INVALID_TEAM' });
  const key = 'sports-bet:' + event.id + ':' + user.tgId;
  const previous = await getTransaction(key);
  if (previous) throw new EndpointError('ဒီ event မှာ တစ်ကြိမ် bet တင်ပြီးပါပြီ။', { code: 'SPORTS_DUPLICATE_BET' });
  const potentialWin = Math.floor(n * Number(team.odd));
  const op = await recordLedgerOperation({
    type: 'sports_bet', fromUserId: String(user.tgId), toUserId: 'TREASURY', amount: n,
    accountUserId: user.tgId, balanceDelta: -n, requiredBalance: n,
    totalWonDelta: 0, totalLostDelta: n, treasuryDelta: n, requiredTreasury: 0,
    idempotencyKey: key,
    meta: { eventId: event.id, alias: keyAlias, teamName: team.name, odd: team.odd, potentialWin,
      username: user.username || null, firstName: user.firstName || null, lastName: user.lastName || null,
      sourceMessageId: Number(messageId || 0) },
  });
  if (op.duplicate) throw new EndpointError('ဒီ event မှာ တစ်ကြိမ် bet တင်ပြီးပါပြီ။', { code: 'SPORTS_DUPLICATE_BET' });
  const updatedUser = await db.select().from(users).where(eq(users.tgId, user.tgId)).get();
  const bet = await db.select().from(sportsBets).where(eq(sportsBets.id, key)).get();
  return { ok: true, bet, balance: Number(updatedUser?.balance || 0), duplicate: false };
}

export async function stopSportsEvent(event, actorId) {
  requireOwner(actorId);
  if (!event) throw new EndpointError('Event မတွေ့ပါ။', { code: 'SPORTS_EVENT_NOT_FOUND' });
  if (event.status === 'stopped') return { ok: true, duplicate: true, event };
  if (event.status !== 'open') throw new EndpointError('Event ကို ပိတ်လို့မရတော့ပါ။', { code: 'SPORTS_EVENT_STATE' });
  await db.update(sportsEvents).set({ status: 'stopped', updatedAt: now() })
    .where(and(eq(sportsEvents.id, event.id), eq(sportsEvents.status, 'open'))).run();
  return { ok: true, duplicate: false, event: await db.select().from(sportsEvents).where(eq(sportsEvents.id, event.id)).get() };
}

export async function settleSportsEvent(event, winnerAlias, actorId) {
  await ensureEconomy();
  requireOwner(actorId);
  if (!event) throw new EndpointError('Event မတွေ့ပါ။', { code: 'SPORTS_EVENT_NOT_FOUND' });
  if (event.status === 'settled') {
    return { ok: true, duplicate: true, event, bets: await db.select().from(sportsBets).where(eq(sportsBets.eventId, event.id)).all() };
  }
  if (event.status !== 'stopped') throw new EndpointError('အရင် .stopbet လုပ်ပြီးမှ settle လုပ်ပါ။', { code: 'SPORTS_EVENT_NOT_STOPPED' });
  const alias = normalizeAlias(winnerAlias);
  const winningTeam = (event.data?.teams || []).find(t => normalizeAlias(t.alias) === alias);
  if (!winningTeam) throw new EndpointError('Winner alias မမှန်ပါ။', { code: 'SPORTS_INVALID_WINNER' });
  const bets = await db.select().from(sportsBets).where(eq(sportsBets.eventId, event.id)).all();
  const winners = bets.filter(b => normalizeAlias(b.choice) === alias);
  const payouts = winners.map(b => ({ userId: Number(b.userId), amount: Number(b.potentialWin) }));
  await settleMultiPayouts({ settlementId: event.id, typePrefix: 'sports', payouts,
    meta: { eventId: event.id, winnerAlias: alias }, histories: bets.map(b => ({
      userId: Number(b.userId), game: 'sports', bet: Number(b.amount),
      payout: normalizeAlias(b.choice) === alias ? Number(b.potentialWin) : 0,
      multiplier: normalizeAlias(b.choice) === alias ? Number(b.potentialWin) / Math.max(1, Number(b.amount)) : 0,
      result: { title: event.title, choice: b.choice, winnerAlias: alias },
      title: event.title, outcome: normalizeAlias(b.choice) === alias ? 'win' : 'lose',
    })) });
  const settledAt = now();
  await db.update(sportsBets).set({ status: 'lost', updatedAt: settledAt })
    .where(and(eq(sportsBets.eventId, event.id), eq(sportsBets.status, 'active'))).run();
  for (const bet of winners) {
    await db.update(sportsBets).set({ status: 'won', updatedAt: settledAt })
      .where(eq(sportsBets.id, bet.id)).run();
  }
  const fresh = await db.select().from(sportsEvents).where(eq(sportsEvents.id, event.id)).get();
  const data = { ...(fresh?.data || event.data || {}), winnerAlias: alias, winnerTeam: winningTeam.name,
    totalWinBal: winners.reduce((sum, b) => sum + Number(b.potentialWin || 0), 0), settledAt: settledAt.toISOString() };
  await db.update(sportsEvents).set({ status: 'settled', result: alias, data, updatedAt: settledAt })
    .where(eq(sportsEvents.id, event.id)).run();
  return { ok: true, duplicate: false, event: await db.select().from(sportsEvents).where(eq(sportsEvents.id, event.id)).get(), bets };
}

export async function createAuction({ actorId, chatId, title, startingBid, minIncrement, minutes, mediaType = null, fileId = null }) {
  await ensureEconomy();
  requireOwner(actorId);
  const start = safeInt(startingBid, 1, 1000000000000), inc = safeInt(minIncrement, 1, 1000000000000);
  const duration = safeInt(minutes, 1, 10080);
  if (!start || !inc || !duration) throw new EndpointError('Starting bid / increment / minutes မမှန်ပါ။', { code: 'AUCTION_INVALID_ARGS' });
  const channelId = safeInt(await getSetting('auction_channel_id', chatId), -1000000000000, 1000000000000);
  if (!channelId) throw new EndpointError('Auction channel ID မမှန်ပါ။', { code: 'AUCTION_CHANNEL_INVALID' });
  const auctionId = id('auc');
  const stamp = now();
  const data = { title: text(title, 200) || 'Auction Item', startingBid: start, minIncrement: inc,
    totalBids: 0, createdBy: Number(actorId), creatorName: null, creatorUsername: null,
    mediaType, fileId, createdAt: stamp.toISOString() };
  await db.insert(auctions).values({ id: auctionId, auctionId, channelId, channelMessageId: null, status: 'open',
    endAt: new Date(stamp.getTime() + duration * 60000), currentBid: 0, highestBidderId: null,
    data, createdAt: stamp, updatedAt: stamp }).run();
  const body = [
    '🔥 <b>LIVE AUCTION</b>', '━━━━━━━━━━━━━━━━', '💎 <b>' + escapeHtml(data.title) + '</b>', '',
    '💰 <b>STARTING BID</b> <b>' + start.toLocaleString('en-US') + ' Bal</b>',
    '📈 <b>MINIMUM INCREMENT</b> <b>' + inc.toLocaleString('en-US') + ' Bal</b>',
    '👥 <b>TOTAL BIDS</b> 0',
    '⏳ <b>TIME LIMIT</b> ' + duration + ' minutes',
    '', 'Reply to this post with <code>.bid ' + start + '</code> or just a number.',
    '', '<code>Auction ID: ' + auctionId + '</code>',
  ].join('\n');
  let sent;
  try {
    if (mediaType === 'photo' && fileId) sent = unwrapMessage(await api.sendPhoto({ chat_id: channelId, photo: fileId, caption: body, parse_mode: 'HTML' }));
    else if (mediaType === 'video' && fileId) sent = unwrapMessage(await api.sendVideo({ chat_id: channelId, video: fileId, caption: body, parse_mode: 'HTML' }));
    else sent = unwrapMessage(await api.sendMessage({ chat_id: channelId, text: body, parse_mode: 'HTML', disable_web_page_preview: true }));
  } catch (error) {
    await db.update(auctions).set({ status: 'failed', updatedAt: now() }).where(eq(auctions.auctionId, auctionId)).run();
    throw new EndpointError('Auction post မတင်နိုင်ပါ။ Bot ကို channel admin ထည့်ထားပြီး channel ID စစ်ပါ။', { code: 'AUCTION_POST_FAILED' });
  }
  const msgId = Number(sent?.message_id ?? sent?.result?.message_id);
  if (!Number.isSafeInteger(msgId) || msgId <= 0) {
    await db.update(auctions).set({ status: 'failed', updatedAt: now() }).where(eq(auctions.auctionId, auctionId)).run();
    throw new EndpointError('Auction post ID မရရှိပါ။', { code: 'AUCTION_POST_FAILED' });
  }
  await db.update(auctions).set({ channelMessageId: msgId, updatedAt: now() }).where(eq(auctions.auctionId, auctionId)).run();
  return { ok: true, auctionId, channelId, messageId: msgId, endAt: new Date(stamp.getTime() + duration * 60000).toISOString() };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export async function findAuctionForReply(message) {
  const reply = message?.reply_to_message;
  if (!reply?.message_id) return null;
  const forwardedChannelId = reply.forward_from_chat?.id || reply.sender_chat?.id || reply.forward_origin?.chat?.id || message.chat?.id;
  const forwardedMessageId = reply.forward_from_message_id || reply.forward_origin?.message_id || reply.message_id;
  const rows = await db.select().from(auctions).where(eq(auctions.status, 'open')).all();
  return rows.find(a =>
    Number(a.channelMessageId) === Number(forwardedMessageId) &&
    (Number(a.channelId) === Number(forwardedChannelId) || Number(a.channelId) === Number(reply.chat?.id))
  ) || null;
}

export async function placeAuctionBid({ auction, telegramUser, amount, messageId, bidChatId }) {
  await ensureEconomy();
  const user = await ensureUser(telegramUser);
  if (!auction || auction.status !== 'open') throw new EndpointError('Auction မဖွင့်ထားပါ။', { code: 'AUCTION_CLOSED' });
  if (new Date(auction.endAt).getTime() <= Date.now()) throw new EndpointError('Auction အချိန်ကုန်သွားပါပြီ။', { code: 'AUCTION_CLOSED' });
  const bid = safeInt(amount, 1, 1000000000000);
  if (!bid) throw new EndpointError('Bid amount မမှန်ပါ။', { code: 'INVALID_AMOUNT' });
  const previousBid = auction.highestBidderId ? Number(auction.currentBid) : 0;
  const previousBidderId = auction.highestBidderId ? Number(auction.highestBidderId) : null;
  const data = auction.data || {};
  const threshold = previousBidderId ? previousBid + Number(data.minIncrement || 1) : Number(data.startingBid || 1);
  if (bid < threshold) throw new EndpointError('အနည်းဆုံး bid ' + threshold.toLocaleString('en-US') + ' Bal လိုအပ်ပါတယ်။', { code: 'AUCTION_BID_TOO_LOW' });
  const key = 'auction-bid:' + auction.auctionId + ':' + Number(bidChatId) + ':' + Number(messageId);
  const result = await recordLedgerOperation({
    type: 'auction_bid', fromUserId: String(user.tgId), toUserId: 'TREASURY', amount: bid,
    accountUserId: user.tgId, balanceDelta: -bid, requiredBalance: bid, totalWonDelta: 0, totalLostDelta: 0,
    treasuryDelta: bid - previousBid, requiredTreasury: previousBid,
    refunds: previousBidderId ? [{ userId: previousBidderId, amount: previousBid }] : [],
    idempotencyKey: key,
    meta: { auctionId: auction.auctionId, previousBid, previousBidderId, bidderName: user.firstName || 'Player',
      bidderUsername: user.username || null, messageId: Number(messageId), bidChatId: Number(bidChatId) },
  });
  const fresh = await db.select().from(auctions).where(eq(auctions.auctionId, auction.auctionId)).get();
  if (!fresh) throw new EndpointError('Auction update မတွေ့ပါ။', { code: 'AUCTION_NOT_FOUND' });
  return { ok: true, duplicate: result.duplicate, auction: fresh, previousBidderId, balance: Number((await db.select().from(users).where(eq(users.tgId, user.tgId)).get())?.balance || 0) };
}

export async function finalizeAuction(auctionId, actorId = null, force = false) {
  await ensureEconomy();
  if (force) requireOwner(actorId);
  const auction = await db.select().from(auctions).where(eq(auctions.auctionId, String(auctionId))).get();
  if (!auction) throw new EndpointError('Auction မတွေ့ပါ။', { code: 'AUCTION_NOT_FOUND' });
  if (auction.status === 'settled' || auction.status === 'closed') return { ok: true, duplicate: true, auction };
  if (auction.status === 'cancelled') return { ok: false, duplicate: true, auction };
  if (!force && new Date(auction.endAt).getTime() > Date.now()) throw new EndpointError('Auction မပြီးသေးပါ။', { code: 'AUCTION_NOT_EXPIRED' });
  if (!['open', 'settling'].includes(auction.status)) throw new EndpointError('Auction state မမှန်ပါ။', { code: 'AUCTION_STATE' });
  if (auction.status === 'open') {
    await db.update(auctions).set({ status: 'settling', updatedAt: now() })
      .where(and(eq(auctions.auctionId, String(auctionId)), eq(auctions.status, 'open'))).run();
  }
  if (auction.highestBidderId && Number(auction.currentBid) > 0) {
    await ensureUser({ id: Number(auction.data?.createdBy), first_name: 'Auction Creator' });
    await credit(Number(auction.data?.createdBy), Number(auction.currentBid), 'auction_seller_payout',
      { auctionId: auction.auctionId, winnerUserId: auction.highestBidderId }, 'auction-payout:' + auction.auctionId);
    await db.update(auctions).set({ status: 'settled', updatedAt: now() }).where(eq(auctions.auctionId, auction.auctionId)).run();
  } else {
    await db.update(auctions).set({ status: 'closed', updatedAt: now() }).where(eq(auctions.auctionId, auction.auctionId)).run();
  }
  return { ok: true, duplicate: false, auction: await db.select().from(auctions).where(eq(auctions.auctionId, auction.auctionId)).get() };
}

export async function cancelAuction(auctionId, actorId) {
  await ensureEconomy();
  requireOwner(actorId);
  const auction = await db.select().from(auctions).where(eq(auctions.auctionId, String(auctionId))).get();
  if (!auction) throw new EndpointError('Auction မတွေ့ပါ။', { code: 'AUCTION_NOT_FOUND' });
  if (auction.status === 'cancelled') return { ok: true, duplicate: true, auction };
  if (!['open', 'cancelling'].includes(auction.status)) throw new EndpointError('Auction ကို cancel လုပ်လို့မရပါ။', { code: 'AUCTION_STATE' });
  if (auction.status === 'open') await db.update(auctions).set({ status: 'cancelling', updatedAt: now() })
    .where(and(eq(auctions.auctionId, auction.auctionId), eq(auctions.status, 'open'))).run();
  if (auction.highestBidderId && Number(auction.currentBid) > 0) {
    await credit(Number(auction.highestBidderId), Number(auction.currentBid), 'auction_cancel_refund',
      { auctionId: auction.auctionId }, 'auction-refund:' + auction.auctionId);
  }
  await db.update(auctions).set({ status: 'cancelled', updatedAt: now() }).where(eq(auctions.auctionId, auction.auctionId)).run();
  return { ok: true, duplicate: false, auction: await db.select().from(auctions).where(eq(auctions.auctionId, auction.auctionId)).get() };
}

export async function reconcileEventMarketsOnUpdate() {
  await ensureEconomy();
  const expired = await db.select().from(auctions).where(eq(auctions.status, 'open')).all();
  const settling = await db.select().from(auctions).where(eq(auctions.status, 'settling')).all();
  const due = [...expired, ...settling].filter(a => new Date(a.endAt).getTime() <= Date.now() || a.status === 'settling').slice(0, 20);
  const out = [];
  for (const auction of due) {
    try { out.push(await finalizeAuction(auction.auctionId)); }
    catch (error) { console.error('BIKA_AUCTION_RECONCILE_FAILED', auction.auctionId, String(error?.message || error)); }
  }
  // Promote RTP timers are evaluated lazily against persisted expiry, which also works after runtime restarts.
  await getActivePromoForAllGroups();
  return { ok: true, expiredAuctionsProcessed: out.length };
}

async function getActivePromoForAllGroups() {
  const rows = await db.select().from(settings).all();
  const stamp = now();
  let ended = 0;
  for (const row of rows) {
    if (!String(row.key).startsWith('promo_rtp:') || !row.value || row.value.ended) continue;
    const expiresAt = Number(row.value.expiresAt || 0);
    if (expiresAt > 0 && expiresAt <= stamp.getTime()) {
      await db.update(settings).set({ value: { ...row.value, ended: true, endedAt: stamp.toISOString(), endReason: 'expired' }, updatedAt: stamp })
        .where(eq(settings.key, row.key)).run();
      ended += 1;
    }
  }
  return ended;
}
