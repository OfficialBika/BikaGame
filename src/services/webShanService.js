'use strict';

const { COIN, SHAN = {} } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getWebGameRtp, setWebGameRtp } = require('./webGameRtpService');
const { recordWebGameHistory } = require('./webBetHistoryService');

const MIN_BET = Math.max(1, Number(process.env.WEB_SHAN_MIN_BET || SHAN.minBet || 50));
const MAX_BET = Math.max(MIN_BET, Number(process.env.WEB_SHAN_MAX_BET || SHAN.maxBet || 10000));
const MIN_BANKER_STAKE = Math.max(MIN_BET * 3, Number(process.env.WEB_SHAN_MIN_BANKER_STAKE || 1000));
const MAX_BANKER_STAKE = Math.max(MIN_BANKER_STAKE, Number(process.env.WEB_SHAN_MAX_BANKER_STAKE || 200000));
const MAX_PLAYERS = Math.max(2, Math.min(7, Number(process.env.WEB_SHAN_MAX_PLAYERS || 6)));
const JOIN_SECONDS = Math.max(12, Number(process.env.WEB_SHAN_JOIN_SECONDS || 45));
const ACTION_SECONDS = Math.max(15, Number(process.env.WEB_SHAN_ACTION_SECONDS || 25));
const ROOM_TTL_MS = Math.max(5 * 60_000, Number(process.env.WEB_SHAN_ROOM_TTL_MS || 20 * 60_000));
const TIN_MS = Math.max(1500, Number(process.env.WEB_SHAN_TIN_MS || 3300));
const BANKER_BET_LIMIT_MULTIPLIER = Math.max(1, Number(process.env.WEB_SHAN_BANKER_BET_LIMIT_MULTIPLIER || 3));
const RTP_GAME_KEY = 'shan';

const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const rooms = new Map();

function nowMs() { return Date.now(); }
function cleanRoomId(value) { return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64); }
function makeRoomId() { return `wshan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
function safeAmount(value) { const n = Number(String(value || '').replace(/,/g, '').trim()); return Number.isFinite(n) ? Math.floor(n) : 0; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function playerName(user = {}) { return [user.first_name || user.firstName, user.last_name || user.lastName].filter(Boolean).join(' ').trim() || user.username || `Player ${String(user.id || user.userId || '').slice(-4)}`; }
function avatarText(name) { return String(name || 'SK').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'SK'; }

function buildDeck() { const deck = []; for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit, red: suit === '♥' || suit === '♦' }); return deck; }
function shuffle(cards) { const deck = [...cards]; for (let i = deck.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; } return deck; }
function draw(room) { if (!room.deck?.length) room.deck = shuffle(buildDeck()); return room.deck.pop(); }
function rankPoint(rank) { if (rank === 'A') return 1; if (['10', 'J', 'Q', 'K'].includes(rank)) return 0; return Number(rank) || 0; }
function highRank(rank) { if (rank === 'A') return 1; if (rank === 'J') return 11; if (rank === 'Q') return 12; if (rank === 'K') return 13; return Number(rank) || 0; }
function points(cards = []) { return cards.reduce((sum, card) => sum + rankPoint(card.rank), 0) % 10; }
function tieRanks(cards = []) { return cards.map((card) => highRank(card.rank)).sort((a, b) => b - a); }
function publicCard(card) { return card ? { rank: card.rank, suit: card.suit, red: !!card.red } : { hidden: true }; }
function hiddenCards(count = 2) { return Array.from({ length: count }, () => ({ hidden: true })); }

function handInfo(cards = []) {
  const handPoints = points(cards);
  const three = cards.length === 3;
  const two = cards.length === 2;
  const sameRank = three && cards.every((card) => card.rank === cards[0].rank);
  const allFace = three && cards.every((card) => ['J', 'Q', 'K'].includes(card.rank));
  const sameSuit = three && cards.every((card) => card.suit === cards[0].suit);
  const natural9 = two && handPoints === 9;
  const natural8 = two && handPoints === 8;
  if (sameRank) return { category: 6, name: 'Shan Koe Mee', short: 'SKM', points: handPoints, tieBreaker: tieRanks(cards) };
  if (allFace) return { category: 5, name: 'Zat Toe', short: 'Face Triple', points: handPoints, tieBreaker: tieRanks(cards) };
  if (sameSuit) return { category: 4, name: 'Same Suit', short: 'Suit', points: handPoints, tieBreaker: tieRanks(cards) };
  if (natural9) return { category: 3, name: 'Natural 9', short: 'Koe Mee', points: handPoints, tieBreaker: tieRanks(cards) };
  if (natural8) return { category: 2, name: 'Natural 8', short: 'Natural 8', points: handPoints, tieBreaker: tieRanks(cards) };
  return { category: 1, name: `${handPoints} Points`, short: `${handPoints} Points`, points: handPoints, tieBreaker: tieRanks(cards) };
}

function compareTie(a = [], b = []) { for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const av = a[i] || 0; const bv = b[i] || 0; if (av > bv) return 1; if (av < bv) return -1; } return 0; }
function compareHands(playerCards, bankerCards) { const player = handInfo(playerCards); const banker = handInfo(bankerCards); let winner = 'PUSH'; if (player.category !== banker.category) winner = player.category > banker.category ? 'PLAYER' : 'BANKER'; else if (player.points !== banker.points) winner = player.points > banker.points ? 'PLAYER' : 'BANKER'; else { const tie = compareTie(player.tieBreaker, banker.tieBreaker); winner = tie > 0 ? 'PLAYER' : tie < 0 ? 'BANKER' : 'PUSH'; } return { winner, player, banker }; }
function payoutFor(winner, bet) { if (winner === 'PLAYER') return bet * 2; if (winner === 'PUSH') return bet; return 0; }
function playerDone(player) { return ['stay', 'draw', 'natural', 'settled'].includes(player.status) || player.hand.length >= 3; }
function currentPlayer(room) { if (!room.turnOrder?.length) return null; const id = room.turnOrder[room.activeIndex] || null; return id ? room.players.get(Number(id)) : null; }
function nextPlayableIndex(room, from = room.activeIndex + 1) { for (let i = from; i < room.turnOrder.length; i += 1) { const p = room.players.get(Number(room.turnOrder[i])); if (p && !playerDone(p)) return i; } return -1; }

async function getWebShanRtp() { return getWebGameRtp(RTP_GAME_KEY); }
async function setWebShanRtp(value, updatedBy = null) { return setWebGameRtp(RTP_GAME_KEY, value, updatedBy); }
async function currentBalance(userId) { try { const user = await getUser(Number(userId)); return Number(user?.balance || 0); } catch (_) { return 0; } }

function cleanupRooms() { const cutoff = nowMs() - ROOM_TTL_MS; for (const [id, room] of rooms) { if (room.finishedAtMs && room.finishedAtMs < cutoff) rooms.delete(id); else if (room.createdAtMs < cutoff && ['expired', 'refunded'].includes(room.state)) rooms.delete(id); } }
function getRoomOrThrow(roomId) { cleanupRooms(); const id = cleanRoomId(roomId); const room = rooms.get(id); if (!room) throw new Error('SHAN_TABLE_NOT_FOUND'); return room; }

async function refundRoom(room, reason = 'expired') {
  if (!room || room.refunded || room.settled) return room;
  room.refunded = true;
  room.state = 'refunded';
  room.finishedAtMs = nowMs();
  const refunds = [];
  if (room.banker?.reserveLocked > 0) refunds.push(treasuryPayToUser(room.banker.userId, room.banker.reserveLocked, { type: 'web_shan_refund_banker', roomId: room.id, reason }));
  for (const player of room.players.values()) if (player.bet > 0) refunds.push(treasuryPayToUser(player.userId, player.bet, { type: 'web_shan_refund_player', roomId: room.id, reason }));
  await Promise.allSettled(refunds);
  return room;
}

async function createWebShanRoom({ chatId = null, title = '', createdBy = null, user = {}, bankerStake = null } = {}) {
  cleanupRooms();
  const bankerId = Number(createdBy || user.id || user.userId);
  if (!Number.isFinite(bankerId) || bankerId <= 0) throw new Error('INVALID_BANKER');
  const stake = clamp(safeAmount(bankerStake || process.env.WEB_SHAN_DEFAULT_BANKER_STAKE || 5000), MIN_BANKER_STAKE, MAX_BANKER_STAKE);
  const betLimit = Math.floor(stake * BANKER_BET_LIMIT_MULTIPLIER);
  const reserveLocked = betLimit; // A full 3x reserve is locked so player payouts are always covered.
  const bankerDoc = await getUser(bankerId);
  if (Number(bankerDoc?.balance || 0) < reserveLocked) {
    const err = new Error('BANKER_INSUFFICIENT_RESERVE');
    err.required = reserveLocked;
    throw err;
  }
  await userPayToTreasury(bankerId, reserveLocked, { type: 'web_shan_banker_reserve', source: 'miniapp_shan_pro', stake, betLimit });
  const name = playerName({ ...user, id: bankerId, firstName: bankerDoc?.firstName, lastName: bankerDoc?.lastName, username: bankerDoc?.username });
  const room = {
    id: makeRoomId(),
    chatId: chatId || null,
    title: String(title || 'Bika Shan Koe Mee Pro Table').slice(0, 90),
    createdAtMs: nowMs(),
    joinDeadlineMs: nowMs() + JOIN_SECONDS * 1000,
    actionDeadlineMs: null,
    state: 'lobby',
    stateLabel: 'WAITING BETS',
    deck: [],
    banker: { userId: bankerId, name, avatar: avatarText(name), username: user.username || bankerDoc?.username || null, stake, betLimit, reserveLocked, cards: [], info: null, payout: 0, net: -reserveLocked },
    players: new Map(),
    totalBet: 0,
    turnOrder: [],
    activeIndex: -1,
    activeUserId: null,
    tinStartedAtMs: null,
    tinUntilMs: null,
    tinStep: 0,
    rtp: await getWebShanRtp(),
    settled: false,
  };
  rooms.set(room.id, room);
  return publicRoom(room, bankerId, await currentBalance(bankerId));
}

function startTin(room) {
  if (room.state !== 'lobby') return room;
  room.state = 'tin';
  room.stateLabel = 'AUTO TIN';
  room.tinStartedAtMs = nowMs();
  room.tinUntilMs = nowMs() + TIN_MS;
  room.tinStep = 1;
  return room;
}

function startRound(room) {
  if (!['lobby', 'tin'].includes(room.state)) return room;
  if (!room.players.size) return room;
  room.deck = shuffle(buildDeck());
  room.banker.cards = [];
  room.banker.info = null;
  room.turnOrder = [...room.players.keys()];
  room.activeIndex = -1;
  room.activeUserId = null;
  for (const player of room.players.values()) {
    player.hand = [];
    player.result = null;
    player.payout = 0;
    player.net = -player.bet;
    player.status = 'playing';
    player.info = null;
  }
  for (let i = 0; i < 2; i += 1) {
    for (const player of room.players.values()) player.hand.push(draw(room));
    room.banker.cards.push(draw(room));
  }
  for (const player of room.players.values()) {
    const info = handInfo(player.hand);
    if (info.category >= 2) { player.status = 'natural'; player.info = info; }
  }
  room.state = 'playing';
  room.stateLabel = 'PLAYER TURNS';
  room.actionDeadlineMs = nowMs() + ACTION_SECONDS * 1000;
  const idx = nextPlayableIndex(room, 0);
  room.activeIndex = idx;
  room.activeUserId = idx >= 0 ? Number(room.turnOrder[idx]) : null;
  if (idx < 0) room.state = 'banker';
  return room;
}

async function maybeAdvance(room) {
  if (!room || room.settled || room.refunded) return room;
  if (room.state === 'lobby') {
    if (room.players.size && (room.totalBet >= room.banker.betLimit || nowMs() >= room.joinDeadlineMs)) startTin(room);
    else if (!room.players.size && nowMs() >= room.joinDeadlineMs) await refundRoom(room, 'no_players');
  }
  if (room.state === 'tin') {
    const elapsed = nowMs() - (room.tinStartedAtMs || nowMs());
    room.tinStep = Math.max(1, Math.min(3, Math.floor(elapsed / Math.max(1, TIN_MS / 3)) + 1));
    if (nowMs() >= room.tinUntilMs) startRound(room);
  }
  if (room.state === 'playing') {
    const active = currentPlayer(room);
    if (!active || playerDone(active) || nowMs() >= room.actionDeadlineMs) {
      if (active && active.status === 'playing') { active.status = 'stay'; active.info = handInfo(active.hand); }
      const next = nextPlayableIndex(room, room.activeIndex + 1);
      if (next >= 0) { room.activeIndex = next; room.activeUserId = Number(room.turnOrder[next]); room.actionDeadlineMs = nowMs() + ACTION_SECONDS * 1000; }
      else { room.state = 'banker'; room.stateLabel = 'BANKER REVEAL'; }
    }
  }
  if (room.state === 'banker') await settleRoom(room);
  return room;
}

async function joinWebShan({ roomId, userId, user = {}, bet } = {}) {
  const room = getRoomOrThrow(roomId);
  await maybeAdvance(room);
  if (room.state !== 'lobby') {
    if (room.players.has(Number(userId)) || Number(room.banker?.userId) === Number(userId)) return publicRoom(room, userId, await currentBalance(userId));
    throw new Error(room.state === 'expired' ? 'SHAN_TABLE_EXPIRED' : 'SHAN_TABLE_ALREADY_STARTED');
  }
  const finalUserId = Number(userId);
  if (!Number.isFinite(finalUserId) || finalUserId <= 0) throw new Error('INVALID_USER');
  if (Number(room.banker.userId) === finalUserId) return publicRoom(room, finalUserId, await currentBalance(finalUserId));
  if (room.players.has(finalUserId)) return publicRoom(room, finalUserId, await currentBalance(finalUserId));
  if (room.players.size >= MAX_PLAYERS) throw new Error('SHAN_TABLE_FULL');
  const finalBet = safeAmount(bet);
  if (finalBet < MIN_BET || finalBet > MAX_BET) { const err = new Error('BET_RANGE'); err.minBet = MIN_BET; err.maxBet = MAX_BET; throw err; }
  if (room.totalBet + finalBet > room.banker.betLimit) {
    const err = new Error('SHAN_BANKER_LIMIT_REACHED');
    err.remaining = Math.max(0, room.banker.betLimit - room.totalBet);
    throw err;
  }
  const userDoc = await getUser(finalUserId);
  if (Number(userDoc?.balance || 0) < finalBet) throw new Error('USER_INSUFFICIENT');
  await userPayToTreasury(finalUserId, finalBet, { type: 'web_shan_player_bet', source: 'miniapp_shan_pro', roomId: room.id, bankerId: room.banker.userId });
  const name = playerName({ ...user, id: finalUserId, firstName: userDoc?.firstName, lastName: userDoc?.lastName, username: userDoc?.username });
  room.players.set(finalUserId, { userId: finalUserId, name, avatar: avatarText(name), username: user.username || userDoc?.username || null, bet: finalBet, hand: [], status: 'waiting', result: null, payout: 0, net: -finalBet, joinedAtMs: nowMs(), info: null });
  room.totalBet += finalBet;
  if (room.totalBet >= room.banker.betLimit) startTin(room);
  return publicRoom(room, finalUserId, await currentBalance(finalUserId));
}

async function drawWebShan({ roomId, userId } = {}) {
  const room = getRoomOrThrow(roomId);
  await maybeAdvance(room);
  const player = room.players.get(Number(userId));
  if (!player) throw new Error('SHAN_NOT_JOINED');
  if (room.state !== 'playing') throw new Error('SHAN_NOT_PLAYING');
  if (Number(room.activeUserId) !== Number(userId)) throw new Error('SHAN_NOT_YOUR_TURN');
  if (player.status !== 'playing') throw new Error('SHAN_ACTION_DONE');
  if (player.hand.length >= 3) throw new Error('SHAN_MAX_CARDS');
  player.hand.push(draw(room));
  player.status = 'draw';
  player.info = handInfo(player.hand);
  await maybeAdvance(room);
  return publicRoom(room, userId, await currentBalance(userId));
}

async function stayWebShan({ roomId, userId } = {}) {
  const room = getRoomOrThrow(roomId);
  await maybeAdvance(room);
  const player = room.players.get(Number(userId));
  if (!player) throw new Error('SHAN_NOT_JOINED');
  if (room.state !== 'playing') throw new Error('SHAN_NOT_PLAYING');
  if (Number(room.activeUserId) !== Number(userId)) throw new Error('SHAN_NOT_YOUR_TURN');
  if (player.status !== 'playing') throw new Error('SHAN_ACTION_DONE');
  player.status = 'stay';
  player.info = handInfo(player.hand);
  await maybeAdvance(room);
  return publicRoom(room, userId, await currentBalance(userId));
}

async function getWebShanStatus({ roomId, userId } = {}) {
  const id = cleanRoomId(roomId);
  let room = id ? rooms.get(id) : null;
  if (!room) return { ok: false, room: null, balance: await currentBalance(userId), config: publicConfig() };
  await maybeAdvance(room);
  return publicRoom(room, userId, await currentBalance(userId));
}

function bankerShouldDraw(cards) {
  const info = handInfo(cards);
  if (info.category >= 2) return false;
  return info.points <= 5;
}

async function settleRoom(room) {
  if (!room || room.settled) return room;
  room.state = 'banker';
  if (bankerShouldDraw(room.banker.cards)) room.banker.cards.push(draw(room));
  room.banker.info = handInfo(room.banker.cards);
  let totalPlayerPayout = 0;
  for (const player of room.players.values()) {
    if (player.status === 'playing') { player.status = 'stay'; player.info = handInfo(player.hand); }
    const cmp = compareHands(player.hand, room.banker.cards);
    const label = cmp.winner === 'PLAYER' ? 'WIN' : cmp.winner === 'BANKER' ? 'LOSE' : 'PUSH';
    const payout = payoutFor(cmp.winner, player.bet);
    player.result = label;
    player.payout = payout;
    player.net = payout - player.bet;
    player.status = 'settled';
    player.info = cmp.player;
    totalPlayerPayout += payout;
    if (payout > 0) await treasuryPayToUser(player.userId, payout, { type: 'web_shan_player_payout', source: 'miniapp_shan_pro', roomId: room.id, bet: player.bet, payout, result: label, bankerId: room.banker.userId });
    await recordWebGameHistory({ userId: player.userId, game: 'shan', title: 'Shan Pro Table', outcome: label.toLowerCase(), bet: player.bet, payout, net: player.net, multiplier: player.bet > 0 ? payout / player.bet : 0, label: `${label} • ${cmp.player.short}`, meta: { roomId: room.id, mode: 'human_banker', bankerId: room.banker.userId, player: cmp.player, banker: cmp.banker, playerCards: player.hand.map(publicCard), bankerCards: room.banker.cards.map(publicCard) } });
  }
  const escrowTotal = room.banker.reserveLocked + room.totalBet;
  const bankerReturn = Math.max(0, escrowTotal - totalPlayerPayout);
  room.banker.payout = bankerReturn;
  room.banker.net = bankerReturn - room.banker.reserveLocked;
  if (bankerReturn > 0) await treasuryPayToUser(room.banker.userId, bankerReturn, { type: 'web_shan_banker_settle', source: 'miniapp_shan_pro', roomId: room.id, bankerReturn, totalPlayerPayout });
  await recordWebGameHistory({ userId: room.banker.userId, game: 'shan', title: 'Shan Banker Table', outcome: room.banker.net >= 0 ? 'win' : 'lose', bet: room.banker.reserveLocked, payout: bankerReturn, net: room.banker.net, multiplier: room.banker.reserveLocked > 0 ? bankerReturn / room.banker.reserveLocked : 0, label: `BANKER • ${room.banker.net >= 0 ? '+' : ''}${room.banker.net}`, meta: { roomId: room.id, mode: 'human_banker', bankerCards: room.banker.cards.map(publicCard), totalBet: room.totalBet, totalPlayerPayout } });
  room.state = 'finished';
  room.stateLabel = 'SETTLED';
  room.settled = true;
  room.finishedAtMs = nowMs();
  return room;
}

function publicPlayer(player, viewerId, room) {
  const me = Number(player.userId) === Number(viewerId);
  const final = ['finished', 'banker'].includes(room.state) || player.status === 'settled';
  const showCards = me || final;
  const info = showCards ? (player.info || (player.hand?.length ? handInfo(player.hand) : null)) : null;
  return { userId: player.userId, name: player.name, avatar: player.avatar, username: player.username, me, active: Number(room.activeUserId) === Number(player.userId), bet: player.bet, status: player.status, result: player.result, payout: player.payout, net: player.net, info, points: info ? info.points : null, cards: showCards ? player.hand.map(publicCard) : hiddenCards(player.hand?.length || 2) };
}

function publicConfig() { return { minBet: MIN_BET, maxBet: MAX_BET, minBankerStake: MIN_BANKER_STAKE, maxBankerStake: MAX_BANKER_STAKE, maxPlayers: MAX_PLAYERS, joinSeconds: JOIN_SECONDS, actionSeconds: ACTION_SECONDS, bankerBetLimitMultiplier: BANKER_BET_LIMIT_MULTIPLIER }; }
function publicRoom(room, viewerId = null, balance = null) {
  const isBanker = Number(room.banker.userId) === Number(viewerId);
  const revealBanker = ['banker', 'finished'].includes(room.state);
  const bankerCards = revealBanker ? room.banker.cards.map(publicCard) : hiddenCards(room.banker.cards?.length || 2);
  const tinStep = room.state === 'tin' ? Math.max(1, Math.min(3, room.tinStep || 1)) : 0;
  const players = [...room.players.values()].map((player) => publicPlayer(player, viewerId, room));
  const me = players.find((player) => player.me) || null;
  return { ok: true, room: { id: room.id, title: room.title, state: room.state, stateLabel: room.stateLabel, maxPlayers: MAX_PLAYERS, playerCount: room.players.size, totalBet: room.totalBet, betLimit: room.banker.betLimit, betLimitMultiplier: BANKER_BET_LIMIT_MULTIPLIER, joinSecondsLeft: room.state === 'lobby' ? Math.max(0, Math.ceil((room.joinDeadlineMs - nowMs()) / 1000)) : 0, actionSecondsLeft: room.state === 'playing' ? Math.max(0, Math.ceil((room.actionDeadlineMs - nowMs()) / 1000)) : 0, tinStep, tinSecondsLeft: room.state === 'tin' ? Math.max(0, Math.ceil((room.tinUntilMs - nowMs()) / 1000)) : 0, activeUserId: room.activeUserId, createdAtMs: room.createdAtMs, banker: { userId: room.banker.userId, name: room.banker.name, avatar: room.banker.avatar, username: room.banker.username, me: isBanker, stake: room.banker.stake, reserveLocked: room.banker.reserveLocked, betLimit: room.banker.betLimit, result: room.banker.net >= 0 ? 'WIN' : 'LOSE', payout: room.banker.payout, net: room.banker.net, info: revealBanker ? (room.banker.info || handInfo(room.banker.cards)) : null, cards: bankerCards }, players, me, rtp: room.rtp }, balance, config: publicConfig() };
}

async function playWebShan({ userId, bet }) {
  const created = await createWebShanRoom({ title: 'Instant Human Banker Shan', createdBy: Number(userId), user: { id: userId }, bankerStake: Math.max(MIN_BANKER_STAKE, safeAmount(bet) * 3) });
  return getWebShanStatus({ roomId: created.room.id, userId });
}

module.exports = { createWebShanRoom, joinWebShan, getWebShanStatus, drawWebShan, stayWebShan, playWebShan, getWebShanRtp, setWebShanRtp, compareHands, handInfo, points, MIN_BET, MAX_BET, MAX_PLAYERS, JOIN_SECONDS, ACTION_SECONDS, MIN_BANKER_STAKE, MAX_BANKER_STAKE };
