'use strict';

const { BLACKJACK = {} } = require('../config/constants');
const { getDb } = require('../config/database');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getWebGameRtp, setWebGameRtp } = require('./webGameRtpService');
const { recordWebGameHistory } = require('./webBetHistoryService');

const MIN_BET = Math.max(1, Number(process.env.WEB_BJ_MIN_BET || BLACKJACK.minBet || 50));
const MAX_BET = Math.max(MIN_BET, Number(process.env.WEB_BJ_MAX_BET || BLACKJACK.maxBet || 10000));
const MAX_PLAYERS = Math.max(2, Math.min(5, Number(process.env.WEB_BJ_MAX_PLAYERS || 5)));
const JOIN_SECONDS = Math.max(15, Number(process.env.WEB_BJ_JOIN_SECONDS || 45));
const ACTION_SECONDS = Math.max(30, Number(process.env.WEB_BJ_ACTION_SECONDS || 90));
const ROOM_TTL_MS = Math.max(5 * 60_000, Number(process.env.WEB_BJ_ROOM_TTL_MS || 15 * 60_000));
const RTP_GAME_KEY = 'blackjack';

const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
const rooms = new Map();

function nowMs() {
  return Date.now();
}

function makeRoomId() {
  return `wbj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanRoomId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 48);
}

function safeBet(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function playerName(user = {}) {
  return [user.first_name || user.firstName, user.last_name || user.lastName].filter(Boolean).join(' ').trim() || user.username || `Player ${String(user.id || '').slice(-4)}`;
}

function avatarText(name) {
  return String(name || 'BJ').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'BJ';
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit });
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(room) {
  if (!room.deck?.length) room.deck = createDeck();
  return room.deck.pop();
}

function makeCard(rank, suit = '♠') {
  return { rank: String(rank), suit };
}

function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.rank)) return 10;
  return Number(card.rank) || 0;
}

function handValue(cards = []) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardValue(card);
    if (card.rank === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isNatural(cards = []) {
  return cards.length === 2 && handValue(cards) === 21;
}

function handForTotal(total) {
  const value = Math.max(17, Math.min(21, Math.floor(Number(total) || 17)));
  if (value === 21) return [makeCard('A', '♠'), makeCard('K', '♥')];
  if (value === 20) return [makeCard('K', '♠'), makeCard('Q', '♥')];
  if (value === 19) return [makeCard('10', '♠'), makeCard('9', '♥')];
  if (value === 18) return [makeCard('10', '♠'), makeCard('8', '♥')];
  return [makeCard('10', '♠'), makeCard('7', '♥')];
}

function bustHand() {
  return [makeCard('K', '♠'), makeCard('8', '♥'), makeCard('6', '♦')];
}

function decideResult(player, dealer) {
  const pv = handValue(player.hand);
  const dv = handValue(dealer);
  const pn = isNatural(player.hand);
  const dn = isNatural(dealer);
  if (pn && dn) return 'PUSH';
  if (pn) return 'BLACKJACK';
  if (dn) return 'LOSE';
  if (pv > 21) return 'LOSE';
  if (dv > 21) return 'WIN';
  if (pv > dv) return 'WIN';
  if (pv < dv) return 'LOSE';
  return 'PUSH';
}

function payoutFor(result, bet) {
  if (result === 'BLACKJACK') return Math.floor(bet * 2.5);
  if (result === 'WIN') return bet * 2;
  if (result === 'PUSH') return bet;
  return 0;
}

function finalActionDone(player) {
  return ['stand', 'bust', 'blackjack', 'settled'].includes(player.status);
}

function cleanupRooms() {
  const cutoff = nowMs() - ROOM_TTL_MS;
  for (const [id, room] of rooms) {
    if (room.finishedAtMs && room.finishedAtMs < cutoff) rooms.delete(id);
    else if (room.createdAtMs < cutoff && ['lobby', 'expired'].includes(room.state)) rooms.delete(id);
  }
}

function getRoomOrThrow(roomId) {
  cleanupRooms();
  const id = cleanRoomId(roomId);
  const room = rooms.get(id);
  if (!room) throw new Error('BJ_ROOM_NOT_FOUND');
  return room;
}

async function getWebBlackjackRtp() {
  return getWebGameRtp(RTP_GAME_KEY);
}

async function setWebBlackjackRtp(value, updatedBy = null) {
  return setWebGameRtp(RTP_GAME_KEY, value, updatedBy);
}

async function createWebBlackjackRoom({ chatId, title = '', createdBy = null } = {}) {
  cleanupRooms();
  const room = {
    id: makeRoomId(),
    chatId: chatId || null,
    title: String(title || 'Bika Blackjack Table').slice(0, 80),
    createdBy,
    createdAtMs: nowMs(),
    joinDeadlineMs: nowMs() + JOIN_SECONDS * 1000,
    actionDeadlineMs: null,
    state: 'lobby',
    deck: [],
    dealer: [],
    players: new Map(),
    rtp: await getWebBlackjackRtp(),
    settled: false,
  };
  rooms.set(room.id, room);
  return publicRoom(room, createdBy);
}

function maybeAutoStartOrExpire(room) {
  if (room.state === 'lobby' && nowMs() >= room.joinDeadlineMs) {
    if (room.players.size > 0) startRound(room);
    else {
      room.state = 'expired';
      room.finishedAtMs = nowMs();
    }
  }
  if (room.state === 'playing' && room.actionDeadlineMs && nowMs() >= room.actionDeadlineMs) {
    for (const player of room.players.values()) {
      if (player.status === 'playing') player.status = 'stand';
    }
    return finishDealer(room).catch((err) => console.error('WEB_BJ_AUTO_FINISH_FAILED:', err?.message || err));
  }
  return null;
}

function startRound(room) {
  if (room.state !== 'lobby') return room;
  if (!room.players.size) {
    room.state = 'expired';
    room.finishedAtMs = nowMs();
    return room;
  }
  room.deck = createDeck();
  room.dealer = [];
  for (const player of room.players.values()) {
    player.hand = [];
    player.result = null;
    player.payout = 0;
    player.net = -player.bet;
    player.status = 'playing';
  }
  for (let i = 0; i < 2; i += 1) {
    for (const player of room.players.values()) player.hand.push(draw(room));
    room.dealer.push(draw(room));
  }
  for (const player of room.players.values()) {
    if (isNatural(player.hand)) player.status = 'blackjack';
  }
  room.state = 'playing';
  room.actionDeadlineMs = nowMs() + ACTION_SECONDS * 1000;
  if ([...room.players.values()].every(finalActionDone)) {
    finishDealer(room).catch((err) => console.error('WEB_BJ_NATURAL_FINISH_FAILED:', err?.message || err));
  }
  return room;
}

function shapeDealerForTable(room) {
  const activeTotals = [...room.players.values()]
    .map((player) => handValue(player.hand))
    .filter((value) => value <= 21);

  if (!activeTotals.length) return handForTotal(18);

  const rtp = Math.max(40, Math.min(95, Number(room.rtp || 65)));
  const friendly = Math.random() * 100 < rtp;

  if (friendly) {
    // Make the reveal exciting: most RTP-friendly rounds let the dealer bust.
    if (Math.random() < 0.72) return bustHand();
    const minTotal = Math.min(...activeTotals);
    return handForTotal(Math.max(17, Math.min(20, minTotal - 1)));
  }

  const maxTotal = Math.max(...activeTotals);
  return handForTotal(Math.max(17, Math.min(21, maxTotal + 1)));
}

async function finishDealer(room) {
  if (!room || room.settled || !['playing', 'dealer'].includes(room.state)) return room;
  room.state = 'dealer';

  room.dealer = shapeDealerForTable(room);
  while (handValue(room.dealer) < 17) room.dealer.push(draw(room));

  for (const player of room.players.values()) {
    const result = decideResult(player, room.dealer);
    const payout = payoutFor(result, player.bet);
    player.result = result;
    player.payout = payout;
    player.net = payout - player.bet;
    player.status = 'settled';

    if (payout > 0) {
      try {
        await treasuryPayToUser(player.userId, payout, {
          type: 'web_blackjack_payout',
          bet: player.bet,
          payout,
          result,
          roomId: room.id,
          rtp: room.rtp,
        });
      } catch (err) {
        console.error('WEB_BJ_PAYOUT_FAILED:', err?.message || err);
        player.result = 'PAYOUT_ERROR';
        player.payout = 0;
        player.net = -player.bet;
      }
    }

    await recordWebGameHistory({
      userId: player.userId,
      game: 'blackjack',
      title: 'Web Blackjack',
      outcome: player.result,
      bet: player.bet,
      payout: player.payout,
      net: player.net,
      label: player.result === 'BLACKJACK' ? 'Blackjack' : player.result,
      meta: {
        roomId: room.id,
        playerTotal: handValue(player.hand),
        dealerTotal: handValue(room.dealer),
        players: room.players.size,
      },
    });
  }

  room.state = 'finished';
  room.settled = true;
  room.finishedAtMs = nowMs();
  return room;
}

async function joinWebBlackjack({ roomId, userId, user = {}, bet } = {}) {
  const room = getRoomOrThrow(roomId);
  maybeAutoStartOrExpire(room);

  if (room.state !== 'lobby') {
    if (room.players.has(Number(userId))) return publicRoom(room, userId);
    throw new Error(room.state === 'expired' ? 'BJ_ROOM_EXPIRED' : 'BJ_ALREADY_STARTED');
  }

  const finalUserId = Number(userId);
  if (!Number.isFinite(finalUserId) || finalUserId <= 0) throw new Error('INVALID_USER');
  if (room.players.has(finalUserId)) return publicRoom(room, finalUserId);
  if (room.players.size >= MAX_PLAYERS) throw new Error('BJ_TABLE_FULL');

  const finalBet = safeBet(bet);
  if (finalBet < MIN_BET || finalBet > MAX_BET) {
    const err = new Error('BET_RANGE');
    err.minBet = MIN_BET;
    err.maxBet = MAX_BET;
    throw err;
  }

  const userDoc = await getUser(finalUserId);
  if (Number(userDoc?.balance || 0) < finalBet) throw new Error('USER_INSUFFICIENT');

  await userPayToTreasury(finalUserId, finalBet, {
    type: 'web_blackjack_bet',
    roomId: room.id,
    playerCount: room.players.size + 1,
  });

  const name = playerName({ ...user, id: finalUserId });
  room.players.set(finalUserId, {
    userId: finalUserId,
    name,
    avatar: avatarText(name),
    username: user.username || null,
    bet: finalBet,
    hand: [],
    status: 'waiting',
    result: null,
    payout: 0,
    net: -finalBet,
    joinedAtMs: nowMs(),
  });

  if (room.players.size >= MAX_PLAYERS) startRound(room);
  return publicRoom(room, finalUserId, await currentBalance(finalUserId));
}

async function hitWebBlackjack({ roomId, userId } = {}) {
  const room = getRoomOrThrow(roomId);
  maybeAutoStartOrExpire(room);
  const player = room.players.get(Number(userId));
  if (!player) throw new Error('BJ_NOT_JOINED');
  if (room.state !== 'playing') throw new Error('BJ_NOT_PLAYING');
  if (player.status !== 'playing') throw new Error('BJ_ACTION_DONE');

  player.hand.push(draw(room));
  const value = handValue(player.hand);
  if (value > 21) player.status = 'bust';
  else if (value === 21) player.status = 'stand';

  if ([...room.players.values()].every(finalActionDone)) await finishDealer(room);
  return publicRoom(room, userId, await currentBalance(userId));
}

async function standWebBlackjack({ roomId, userId } = {}) {
  const room = getRoomOrThrow(roomId);
  maybeAutoStartOrExpire(room);
  const player = room.players.get(Number(userId));
  if (!player) throw new Error('BJ_NOT_JOINED');
  if (room.state !== 'playing') throw new Error('BJ_NOT_PLAYING');
  if (player.status !== 'playing') throw new Error('BJ_ACTION_DONE');

  player.status = 'stand';
  if ([...room.players.values()].every(finalActionDone)) await finishDealer(room);
  return publicRoom(room, userId, await currentBalance(userId));
}

async function currentBalance(userId) {
  try {
    const user = await getUser(Number(userId));
    return Number(user?.balance || 0);
  } catch (_) {
    return 0;
  }
}

async function getWebBlackjackStatus({ roomId, userId } = {}) {
  const room = getRoomOrThrow(roomId);
  const auto = maybeAutoStartOrExpire(room);
  if (auto && typeof auto.then === 'function') await auto;
  return publicRoom(room, userId, await currentBalance(userId));
}

function publicCard(card) {
  if (!card) return { hidden: true };
  return { rank: card.rank, suit: card.suit, red: ['♥', '♦'].includes(card.suit) };
}

function publicPlayer(player, viewerId) {
  const me = Number(player.userId) === Number(viewerId);
  return {
    userId: player.userId,
    name: player.name,
    avatar: player.avatar,
    me,
    bet: player.bet,
    status: player.status,
    result: player.result,
    payout: player.payout,
    net: player.net,
    total: me ? handValue(player.hand) : null,
    cards: me ? player.hand.map(publicCard) : player.hand.map(() => ({ hidden: true })),
  };
}

function publicRoom(room, viewerId = null, balance = null) {
  const revealDealer = ['dealer', 'finished'].includes(room.state);
  const players = [...room.players.values()].map((player) => publicPlayer(player, viewerId));
  const me = players.find((player) => player.me) || null;
  return {
    ok: true,
    room: {
      id: room.id,
      title: room.title,
      state: room.state,
      maxPlayers: MAX_PLAYERS,
      playerCount: room.players.size,
      joinSecondsLeft: room.state === 'lobby' ? Math.max(0, Math.ceil((room.joinDeadlineMs - nowMs()) / 1000)) : 0,
      actionSecondsLeft: room.state === 'playing' ? Math.max(0, Math.ceil((room.actionDeadlineMs - nowMs()) / 1000)) : 0,
      createdAtMs: room.createdAtMs,
      dealer: {
        reveal: revealDealer,
        total: revealDealer ? handValue(room.dealer) : null,
        cards: revealDealer ? room.dealer.map(publicCard) : room.dealer.map(() => ({ hidden: true })),
      },
      players,
      me,
      rtp: room.rtp,
    },
    balance,
    config: {
      minBet: MIN_BET,
      maxBet: MAX_BET,
      maxPlayers: MAX_PLAYERS,
      joinSeconds: JOIN_SECONDS,
      actionSeconds: ACTION_SECONDS,
    },
  };
}

module.exports = {
  createWebBlackjackRoom,
  joinWebBlackjack,
  getWebBlackjackStatus,
  hitWebBlackjack,
  standWebBlackjack,
  getWebBlackjackRtp,
  setWebBlackjackRtp,
  MIN_BET,
  MAX_BET,
  MAX_PLAYERS,
  JOIN_SECONDS,
  ACTION_SECONDS,
};
