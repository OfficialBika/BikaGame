'use strict';

const { COIN, SHAN = {} } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getWebGameRtp, setWebGameRtp } = require('./webGameRtpService');
const { recordWebGameHistory } = require('./webBetHistoryService');

const MIN_BET = Math.max(1, Number(process.env.WEB_SHAN_MIN_BET || SHAN.minBet || 50));
const MAX_BET = Math.max(MIN_BET, Number(process.env.WEB_SHAN_MAX_BET || SHAN.maxBet || 10000));
const MAX_PLAYERS = Math.max(2, Math.min(7, Number(process.env.WEB_SHAN_MAX_PLAYERS || 6)));
const JOIN_SECONDS = Math.max(12, Number(process.env.WEB_SHAN_JOIN_SECONDS || 35));
const ACTION_SECONDS = Math.max(20, Number(process.env.WEB_SHAN_ACTION_SECONDS || 45));
const ROOM_TTL_MS = Math.max(5 * 60_000, Number(process.env.WEB_SHAN_ROOM_TTL_MS || 18 * 60_000));
const RTP_GAME_KEY = 'shan';

const SUITS = Object.freeze(['♠', '♥', '♦', '♣']);
const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const rooms = new Map();

function nowMs() { return Date.now(); }

function cleanRoomId(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}

function makeRoomId() {
  return `wshan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeBet(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

function playerName(user = {}) {
  return [user.first_name || user.firstName, user.last_name || user.lastName].filter(Boolean).join(' ').trim()
    || user.username
    || `Player ${String(user.id || '').slice(-4)}`;
}

function avatarText(name) {
  return String(name || 'SK').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || 'SK';
}

function buildDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ rank, suit, red: suit === '♥' || suit === '♦' });
  }
  return deck;
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function draw(room) {
  if (!room.deck?.length) room.deck = shuffle(buildDeck());
  return room.deck.pop();
}

function rankPoint(rank) {
  if (rank === 'A') return 1;
  if (['10', 'J', 'Q', 'K'].includes(rank)) return 0;
  return Number(rank) || 0;
}

function highRank(rank) {
  if (rank === 'A') return 1;
  if (rank === 'J') return 11;
  if (rank === 'Q') return 12;
  if (rank === 'K') return 13;
  return Number(rank) || 0;
}

function points(cards = []) {
  return cards.reduce((sum, card) => sum + rankPoint(card.rank), 0) % 10;
}

function tieRanks(cards = []) {
  return cards.map((card) => highRank(card.rank)).sort((a, b) => b - a);
}

function cardSignature(card) {
  return `${card.rank}${card.suit}`;
}

function handInfo(cards = []) {
  const handPoints = points(cards);
  const three = cards.length === 3;
  const two = cards.length === 2;
  const sameRank = three && cards.every((card) => card.rank === cards[0].rank);
  const allFace = three && cards.every((card) => ['J', 'Q', 'K'].includes(card.rank));
  const sameSuit = three && cards.every((card) => card.suit === cards[0].suit);
  const natural9 = two && handPoints === 9;
  const natural8 = two && handPoints === 8;

  // Local casino variants differ by table. This order keeps the web game consistent and configurable:
  // 3 of a kind / face triple / same suit are treated as premium specials, then two-card natural 9/8,
  // then normal modulo-10 point comparison.
  if (sameRank) return { category: 6, name: 'Shan Koe Mee', short: 'SKM', points: handPoints, tieBreaker: tieRanks(cards) };
  if (allFace) return { category: 5, name: 'Zat Toe', short: 'Face Triple', points: handPoints, tieBreaker: tieRanks(cards) };
  if (sameSuit) return { category: 4, name: 'Same Suit', short: 'Suit', points: handPoints, tieBreaker: tieRanks(cards) };
  if (natural9) return { category: 3, name: 'Natural 9', short: 'Koe Mee', points: handPoints, tieBreaker: tieRanks(cards) };
  if (natural8) return { category: 2, name: 'Natural 8', short: '8 Natural', points: handPoints, tieBreaker: tieRanks(cards) };
  return { category: 1, name: `${handPoints} Points`, short: `${handPoints} Points`, points: handPoints, tieBreaker: tieRanks(cards) };
}

function compareTie(a = [], b = []) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function compareHands(playerCards, dealerCards) {
  const player = handInfo(playerCards);
  const dealer = handInfo(dealerCards);
  let winner = 'PUSH';
  if (player.category !== dealer.category) winner = player.category > dealer.category ? 'PLAYER' : 'DEALER';
  else if (player.points !== dealer.points) winner = player.points > dealer.points ? 'PLAYER' : 'DEALER';
  else {
    const tie = compareTie(player.tieBreaker, dealer.tieBreaker);
    winner = tie > 0 ? 'PLAYER' : tie < 0 ? 'DEALER' : 'PUSH';
  }
  return { winner, player, dealer };
}

function payoutFor(winner, bet) {
  if (winner === 'PLAYER') return bet * 2;
  if (winner === 'PUSH') return bet;
  return 0;
}

function playerDone(player) {
  return ['stay', 'draw', 'natural', 'settled'].includes(player.status) || player.hand.length >= 3;
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
  if (!room) throw new Error('SHAN_ROOM_NOT_FOUND');
  return room;
}

async function getWebShanRtp() { return getWebGameRtp(RTP_GAME_KEY); }
async function setWebShanRtp(value, updatedBy = null) { return setWebGameRtp(RTP_GAME_KEY, value, updatedBy); }

async function createWebShanRoom({ chatId = null, title = '', createdBy = null } = {}) {
  cleanupRooms();
  const room = {
    id: makeRoomId(),
    chatId: chatId || null,
    title: String(title || 'Bika Shan Koe Mee Table').slice(0, 90),
    createdBy,
    createdAtMs: nowMs(),
    joinDeadlineMs: nowMs() + JOIN_SECONDS * 1000,
    actionDeadlineMs: null,
    state: 'lobby',
    deck: [],
    dealer: [],
    players: new Map(),
    rtp: await getWebShanRtp(),
    settled: false,
  };
  rooms.set(room.id, room);
  return publicRoom(room, createdBy);
}

function startRound(room) {
  if (room.state !== 'lobby') return room;
  if (!room.players.size) {
    room.state = 'expired';
    room.finishedAtMs = nowMs();
    return room;
  }
  room.deck = shuffle(buildDeck());
  room.dealer = [];
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
    room.dealer.push(draw(room));
  }
  for (const player of room.players.values()) {
    const info = handInfo(player.hand);
    if (info.category >= 2) {
      player.status = 'natural';
      player.info = info;
    }
  }
  room.state = 'playing';
  room.actionDeadlineMs = nowMs() + ACTION_SECONDS * 1000;
  return room;
}

function candidateDeckExcluding(used = []) {
  const usedCounts = new Map();
  for (const card of used) {
    const sig = cardSignature(card);
    usedCounts.set(sig, (usedCounts.get(sig) || 0) + 1);
  }
  return buildDeck().filter((card) => {
    const sig = cardSignature(card);
    const count = usedCounts.get(sig) || 0;
    if (count > 0) {
      usedCounts.set(sig, count - 1);
      return false;
    }
    return true;
  });
}

function randomDealerCandidate(room) {
  const used = [];
  for (const player of room.players.values()) used.push(...player.hand);
  const deck = shuffle(candidateDeckExcluding(used));
  let dealer = [deck.pop(), deck.pop()];
  const initial = handInfo(dealer);
  // House draw rule: natural 8/9 stands; 0-5 draws; 6/7 usually stands but occasionally draws for drama.
  if (initial.category < 2) {
    const p = initial.points;
    if (p <= 5 || (p <= 7 && Math.random() < 0.18)) dealer.push(deck.pop());
  }
  return dealer;
}

function returnRatioForDealer(room, dealerCards) {
  let totalBet = 0;
  let totalPayout = 0;
  for (const player of room.players.values()) {
    totalBet += player.bet;
    totalPayout += payoutFor(compareHands(player.hand, dealerCards).winner, player.bet);
  }
  return totalBet > 0 ? totalPayout / totalBet : 0;
}

function chooseDealerForRtp(room) {
  const target = Math.max(0.40, Math.min(0.95, Number(room.rtp || 68) / 100));
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < 280; i += 1) {
    const dealer = randomDealerCandidate(room);
    const ratio = returnRatioForDealer(room, dealer);
    // small randomness prevents identical-looking house behavior while still targeting long-run RTP.
    const score = Math.abs(ratio - target) + Math.random() * 0.03;
    if (score < bestScore) { bestScore = score; best = dealer; }
  }
  return best || randomDealerCandidate(room);
}

async function settleRoom(room) {
  if (!room || room.settled || !['playing', 'dealer'].includes(room.state)) return room;
  room.state = 'dealer';
  for (const player of room.players.values()) {
    if (player.status === 'playing') player.status = 'stay';
  }
  room.dealer = chooseDealerForRtp(room);

  for (const player of room.players.values()) {
    const cmp = compareHands(player.hand, room.dealer);
    const label = cmp.winner === 'PLAYER' ? 'WIN' : cmp.winner === 'DEALER' ? 'LOSE' : 'PUSH';
    const payout = payoutFor(cmp.winner, player.bet);
    player.result = label;
    player.payout = payout;
    player.net = payout - player.bet;
    player.status = 'settled';
    player.info = cmp.player;

    if (payout > 0) {
      try {
        await treasuryPayToUser(player.userId, payout, {
          type: 'web_shan_payout',
          source: 'miniapp_shan_room',
          roomId: room.id,
          bet: player.bet,
          payout,
          result: label,
          rtp: room.rtp,
        });
      } catch (err) {
        console.error('WEB_SHAN_PAYOUT_FAILED:', err?.message || err);
        player.result = 'PAYOUT_ERROR';
        player.payout = 0;
        player.net = -player.bet;
      }
    }

    await recordWebGameHistory({
      userId: player.userId,
      game: 'shan',
      title: 'Shan Koe Mee Table',
      outcome: String(player.result || '').toLowerCase(),
      bet: player.bet,
      payout: player.payout,
      net: player.net,
      multiplier: player.bet > 0 ? player.payout / player.bet : 0,
      label: `${player.result} • ${cmp.player.short}`,
      meta: {
        roomId: room.id,
        player: cmp.player,
        dealer: cmp.dealer,
        playerCards: player.hand.map(publicCard),
        dealerCards: room.dealer.map(publicCard),
        players: room.players.size,
        rtp: room.rtp,
      },
    });
  }
  room.state = 'finished';
  room.settled = true;
  room.finishedAtMs = nowMs();
  return room;
}

function maybeAutoStartOrSettle(room) {
  if (room.state === 'lobby' && nowMs() >= room.joinDeadlineMs) {
    if (room.players.size > 0) startRound(room);
    else {
      room.state = 'expired';
      room.finishedAtMs = nowMs();
    }
  }
  if (room.state === 'playing' && room.actionDeadlineMs && nowMs() >= room.actionDeadlineMs) {
    return settleRoom(room).catch((err) => console.error('WEB_SHAN_AUTO_SETTLE_FAILED:', err?.message || err));
  }
  if (room.state === 'playing' && [...room.players.values()].every(playerDone)) {
    return settleRoom(room).catch((err) => console.error('WEB_SHAN_ALL_DONE_SETTLE_FAILED:', err?.message || err));
  }
  return null;
}

async function joinWebShan({ roomId, userId, user = {}, bet } = {}) {
  const room = getRoomOrThrow(roomId);
  const auto = maybeAutoStartOrSettle(room);
  if (auto && typeof auto.then === 'function') await auto;
  if (room.state !== 'lobby') {
    if (room.players.has(Number(userId))) return publicRoom(room, userId, await currentBalance(userId));
    throw new Error(room.state === 'expired' ? 'SHAN_ROOM_EXPIRED' : 'SHAN_ALREADY_STARTED');
  }

  const finalUserId = Number(userId);
  if (!Number.isFinite(finalUserId) || finalUserId <= 0) throw new Error('INVALID_USER');
  if (room.players.has(finalUserId)) return publicRoom(room, finalUserId, await currentBalance(finalUserId));
  if (room.players.size >= MAX_PLAYERS) throw new Error('SHAN_TABLE_FULL');

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
    type: 'web_shan_bet',
    source: 'miniapp_shan_room',
    roomId: room.id,
    playerCount: room.players.size + 1,
    rtp: room.rtp,
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
    info: null,
  });

  if (room.players.size >= MAX_PLAYERS) startRound(room);
  return publicRoom(room, finalUserId, await currentBalance(finalUserId));
}

async function drawWebShan({ roomId, userId } = {}) {
  const room = getRoomOrThrow(roomId);
  const auto = maybeAutoStartOrSettle(room);
  if (auto && typeof auto.then === 'function') await auto;
  const player = room.players.get(Number(userId));
  if (!player) throw new Error('SHAN_NOT_JOINED');
  if (room.state !== 'playing') throw new Error('SHAN_NOT_PLAYING');
  if (player.status !== 'playing') throw new Error('SHAN_ACTION_DONE');
  if (player.hand.length >= 3) throw new Error('SHAN_MAX_CARDS');
  player.hand.push(draw(room));
  player.status = 'draw';
  player.info = handInfo(player.hand);
  const after = maybeAutoStartOrSettle(room);
  if (after && typeof after.then === 'function') await after;
  return publicRoom(room, userId, await currentBalance(userId));
}

async function stayWebShan({ roomId, userId } = {}) {
  const room = getRoomOrThrow(roomId);
  const auto = maybeAutoStartOrSettle(room);
  if (auto && typeof auto.then === 'function') await auto;
  const player = room.players.get(Number(userId));
  if (!player) throw new Error('SHAN_NOT_JOINED');
  if (room.state !== 'playing') throw new Error('SHAN_NOT_PLAYING');
  if (player.status !== 'playing') throw new Error('SHAN_ACTION_DONE');
  player.status = 'stay';
  player.info = handInfo(player.hand);
  const after = maybeAutoStartOrSettle(room);
  if (after && typeof after.then === 'function') await after;
  return publicRoom(room, userId, await currentBalance(userId));
}

async function getWebShanStatus({ roomId, userId } = {}) {
  const id = cleanRoomId(roomId);
  let room = id ? rooms.get(id) : null;
  if (!room) {
    room = (await createWebShanRoom({ title: 'Bika Shan Koe Mee Table', createdBy: Number(userId) || null })).room;
    return getWebShanStatus({ roomId: room.id, userId });
  }
  const auto = maybeAutoStartOrSettle(room);
  if (auto && typeof auto.then === 'function') await auto;
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

function publicCard(card) {
  if (!card) return { hidden: true };
  return { rank: card.rank, suit: card.suit, red: !!card.red };
}

function publicPlayer(player, viewerId) {
  const me = Number(player.userId) === Number(viewerId);
  const showCards = me || player.status === 'settled';
  const info = showCards ? (player.info || handInfo(player.hand)) : null;
  return {
    userId: player.userId,
    name: player.name,
    avatar: player.avatar,
    username: player.username,
    me,
    bet: player.bet,
    status: player.status,
    result: player.result,
    payout: player.payout,
    net: player.net,
    info,
    points: info ? info.points : null,
    cards: showCards ? player.hand.map(publicCard) : player.hand.map(() => ({ hidden: true })),
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
        info: revealDealer ? handInfo(room.dealer) : null,
        cards: revealDealer ? room.dealer.map(publicCard) : (room.dealer.length ? room.dealer.map(() => ({ hidden: true })) : [{ hidden: true }, { hidden: true }]),
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

// Backward-compatible single deal API: create a private room, join, auto-start, stand, settle.
async function playWebShan({ userId, bet }) {
  const created = await createWebShanRoom({ title: 'Instant Shan Koe Mee', createdBy: Number(userId) || null });
  await joinWebShan({ roomId: created.room.id, userId, user: { id: userId }, bet });
  const room = getRoomOrThrow(created.room.id);
  startRound(room);
  await stayWebShan({ roomId: room.id, userId });
  return publicRoom(room, userId, await currentBalance(userId));
}

module.exports = {
  createWebShanRoom,
  joinWebShan,
  getWebShanStatus,
  drawWebShan,
  stayWebShan,
  playWebShan,
  getWebShanRtp,
  setWebShanRtp,
  compareHands,
  handInfo,
  points,
  MIN_BET,
  MAX_BET,
  MAX_PLAYERS,
  JOIN_SECONDS,
  ACTION_SECONDS,
};
