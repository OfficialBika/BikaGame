'use strict';

const { COIN, CRASH = {} } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getTreasury } = require('./treasuryService');
const { fullNameFromTg } = require('../utils/helpers');

const rooms = new Map();

const DEFAULT_ROOM_ID = 'global';
const BET_SECONDS = Math.max(6, Number(process.env.WEB_CRASH_BET_SECONDS || CRASH.betSeconds || 15));
const NEXT_ROUND_DELAY_MS = Math.max(500, Number(process.env.WEB_CRASH_NEXT_ROUND_DELAY_MS || 1200));
const MIN_BET = Math.max(1, Number(CRASH.minBet || process.env.CRASH_MIN_BET || 50));
const MAX_BET = Math.max(MIN_BET, Number(CRASH.maxBet || process.env.CRASH_MAX_BET || 10000));
const MAX_PLAYERS = Math.max(2, Number(process.env.WEB_CRASH_MAX_PLAYERS || CRASH.maxPlayers || 250));
const HOUSE_EDGE = Math.max(0.05, Math.min(0.55, Number(CRASH.houseEdge ?? process.env.CRASH_HOUSE_EDGE ?? 0.24)));
const CAP_PERCENT = Math.max(0.03, Math.min(0.50, Number(CRASH.capPercent ?? process.env.CRASH_CAP_PERCENT ?? 0.12)));
const CRASH_MAX_MULTIPLIER = Math.max(1.2, Math.min(30, Number(CRASH.maxMultiplier || process.env.CRASH_MAX_MULTIPLIER || 6)));
const PAYOUT_MAX_MULTIPLIER = Math.max(1, Math.min(CRASH_MAX_MULTIPLIER, Number(CRASH.maxPayoutMultiplier || process.env.CRASH_MAX_PAYOUT_MULTIPLIER || 4)));
const INSTANT_CRASH_PERCENT = Math.max(0, Math.min(35, Number(CRASH.instantCrashPercent || process.env.CRASH_INSTANT_PERCENT || 10)));
const MIN_VISIBLE_MULTIPLIER = Math.max(1.05, Math.min(CRASH_MAX_MULTIPLIER, Number(CRASH.minVisibleMultiplier || process.env.CRASH_MIN_VISIBLE_MULTIPLIER || 1.16)));
const LOW_CRASH_MAX_MULTIPLIER = Math.max(MIN_VISIBLE_MULTIPLIER, Math.min(CRASH_MAX_MULTIPLIER, Number(CRASH.lowCrashMaxMultiplier || process.env.CRASH_LOW_CRASH_MAX_MULTIPLIER || 1.35)));
const MIN_CASHOUT_MULTIPLIER = Math.max(1, Math.min(PAYOUT_MAX_MULTIPLIER, Number(CRASH.minCashoutMultiplier || process.env.CRASH_MIN_CASHOUT_MULTIPLIER || 1.10)));
const DISPLAY_PLAYER_LIMIT = Math.max(12, Number(process.env.WEB_CRASH_DISPLAY_PLAYER_LIMIT || CRASH.displayPlayerLimit || 30));
const ALL_CASHOUT_HYPE_MIN = Math.max(8, Number(CRASH.allCashoutHypeMin || process.env.CRASH_ALL_CASHOUT_HYPE_MIN || 25));
const ALL_CASHOUT_HYPE_MAX = Math.max(ALL_CASHOUT_HYPE_MIN, Number(CRASH.allCashoutHypeMax || process.env.CRASH_ALL_CASHOUT_HYPE_MAX || 250));
const HYPE_EVERY_ALL_CASHOUT_ROUNDS = Math.max(2, Number(process.env.WEB_CRASH_HYPE_EVERY_ALL_CASHOUT_ROUNDS || 20));
const HYPE_EXTRA_CHANCE_PERCENT = Math.max(0, Math.min(100, Number(process.env.WEB_CRASH_HYPE_EXTRA_CHANCE_PERCENT || 0)));
const HISTORY_LIMIT = Math.max(5, Number(process.env.WEB_CRASH_HISTORY_LIMIT || 12));

function cleanUserId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
}

function parseBet(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function round2(value) {
  return Math.max(1, Math.floor(Number(value || 1) * 100) / 100);
}

function makeId(prefix = 'wcr') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function publicName(tg = {}) {
  return fullNameFromTg(tg) || tg.username || 'Player';
}

function totalBet(round) {
  let total = 0;
  if (!round?.players) return total;
  for (const player of round.players.values()) total += Number(player.bet || 0);
  return total;
}

function totalPaid(round) {
  let total = 0;
  if (!round?.players) return total;
  for (const player of round.players.values()) total += Number(player.payout || 0);
  return total;
}

function cashoutCount(round) {
  let count = 0;
  if (!round?.players) return count;
  for (const player of round.players.values()) if (player.cashedOut) count += 1;
  return count;
}

function activePlayers(round) {
  return [...(round?.players?.values?.() || [])].filter((player) => !player.cashedOut);
}

function allPlayersCashedOut(round) {
  return round?.players?.size > 0 && cashoutCount(round) >= round.players.size;
}

function generateCrashPoint(round, treasuryBalance = 0) {
  const betTotal = totalBet(round);
  const playerCount = round?.players?.size || 0;

  if (Math.random() * 100 < INSTANT_CRASH_PERCENT) {
    return round2(MIN_VISIBLE_MULTIPLIER + Math.random() * (LOW_CRASH_MAX_MULTIPLIER - MIN_VISIBLE_MULTIPLIER));
  }

  const r = Math.max(0.0001, Math.min(0.9999, Math.random()));
  let point = (1 - HOUSE_EDGE) / (1 - r);

  // Multiplayer web is controlled, but not frozen. This keeps the curve fair and smooth.
  point *= 0.68 + Math.random() * 0.18;

  if (playerCount >= 25) point *= 0.80;
  else if (playerCount >= 12) point *= 0.86;
  else if (playerCount >= 6) point *= 0.92;

  if (betTotal >= MAX_BET * 12) point *= 0.70;
  else if (betTotal >= MAX_BET * 6) point *= 0.78;
  else if (betTotal >= MAX_BET * 3) point *= 0.86;

  if (treasuryBalance > 0 && betTotal > 0) {
    const possibleMaxPayout = betTotal * PAYOUT_MAX_MULTIPLIER;
    const treasuryRiskLimit = Math.max(MAX_BET, treasuryBalance * CAP_PERCENT);
    if (possibleMaxPayout > treasuryRiskLimit) {
      point *= Math.max(0.55, treasuryRiskLimit / possibleMaxPayout);
    }
  }

  return round2(Math.max(MIN_VISIBLE_MULTIPLIER, Math.min(point, CRASH_MAX_MULTIPLIER)));
}

function generateHypeTarget() {
  const curved = Math.pow(Math.random(), 1.8);
  return round2(ALL_CASHOUT_HYPE_MIN + curved * (ALL_CASHOUT_HYPE_MAX - ALL_CASHOUT_HYPE_MIN));
}

function shouldStartHype(room) {
  room.allCashoutRoundCount = Number(room.allCashoutRoundCount || 0) + 1;
  if (room.allCashoutRoundCount % HYPE_EVERY_ALL_CASHOUT_ROUNDS === 0) return true;
  return Math.random() * 100 < HYPE_EXTRA_CHANCE_PERCENT;
}

function normalCrashDurationMs(target) {
  const m = Math.max(MIN_VISIBLE_MULTIPLIER, Number(target || MIN_VISIBLE_MULTIPLIER));
  if (m <= 1.25) return 3000 + Math.round((m - 1.05) * 4200);
  if (m <= 2) return 4200 + Math.round((m - 1.25) * 4200);
  if (m <= 4) return 7350 + Math.round((m - 2) * 3600);
  return Math.min(26000, 14550 + Math.round((m - 4) * 2500));
}

function hypeDurationMs(current, target) {
  const from = Math.max(1, Number(current || 1));
  const to = Math.max(from, Number(target || from));
  return Math.min(22000, Math.max(4200, Math.round(2600 + Math.log(to / from + 1) * 5200)));
}

function multiplierAtElapsed(elapsedMs, durationMs, target, from = 1, hypeMode = false) {
  const start = Math.max(1, Number(from || 1));
  const end = Math.max(start, Number(target || start));
  const duration = Math.max(1, Number(durationMs || 1));
  const progress = Math.max(0, Math.min(1, Number(elapsedMs || 0) / duration));

  if (progress >= 1) return round2(end);

  if (hypeMode) {
    // Smooth acceleration for the rare 1/20 all-cashout show-off round.
    const eased = Math.pow(progress, 1.28);
    return round2(start + (end - start) * eased);
  }

  // Gentle normal climb. It avoids the visual freeze caused by timer drift or polling gaps.
  const eased = Math.pow(progress, 1.12);
  return round2(start + (end - start) * eased);
}

function currentTarget(round) {
  return round.hypeMode && allPlayersCashedOut(round) ? round.hypeTarget : round.crashPoint;
}

function computeRoundMultiplier(round, now = Date.now()) {
  if (!round || round.state !== 'running') return Number(round?.currentMultiplier || 1);

  const started = Number(round.startedAtMs || now);
  const target = currentTarget(round);
  const duration = Math.max(1, Number(round.crashDurationMs || normalCrashDurationMs(target)));
  const from = Math.max(1, Number(round.multiplierFrom || 1));
  const elapsed = Math.max(0, now - started);
  return multiplierAtElapsed(elapsed, duration, target, from, !!round.hypeMode);
}

function advanceRoom(room, now = Date.now()) {
  const round = room?.round;
  if (!round) return null;

  if (round.state === 'betting' && now >= round.bettingEndsAtMs) {
    closeBettingRound(room).catch((err) => console.error('WEB_CRASH_AUTOCLOSE_FAILED:', err?.stack || err?.message || err));
    return round;
  }

  if (round.state !== 'running') return round;

  round.currentMultiplier = computeRoundMultiplier(round, now);

  const target = currentTarget(round);
  const crashAt = Number(round.crashAtMs || 0);
  if (round.currentMultiplier >= target || (crashAt > 0 && now >= crashAt)) {
    round.currentMultiplier = round2(target);
    finishRound(room, 'crashed');
  }

  return room.round || room.lastRound;
}

function crashHistoryColor(value) {
  const m = Number(value || 1);
  if (m < 1.5) return 'red';
  if (m < 2.5) return 'yellow';
  if (m < 5) return 'blue';
  return 'green';
}

function pushHistory(room, round) {
  if (!room || !round) return;
  const multiplier = Number(round.currentMultiplier || round.crashPoint || 1);
  room.history = [
    {
      roundNo: round.no,
      multiplier,
      color: crashHistoryColor(multiplier),
      hype: !!round.hypeMode,
      players: round.players?.size || 0,
      totalBet: totalBet(round),
      endedAtMs: Date.now(),
    },
    ...(room.history || []),
  ].slice(0, HISTORY_LIMIT);
}

function snapshotRound(round) {
  if (!round) return null;
  return {
    id: round.id,
    no: round.no,
    state: round.state,
    players: new Map(round.players ? [...round.players.entries()].map(([key, player]) => [key, { ...player }]) : []),
    currentMultiplier: round.currentMultiplier,
    crashPoint: round.crashPoint,
    hypeMode: !!round.hypeMode,
    hypeTarget: round.hypeTarget,
    betStartedAtMs: round.betStartedAtMs,
    bettingEndsAtMs: round.bettingEndsAtMs,
    startedAtMs: round.startedAtMs,
    crashAtMs: round.crashAtMs,
    crashDurationMs: round.crashDurationMs,
    multiplierFrom: round.multiplierFrom,
    endedAtMs: round.endedAtMs,
    createdAt: round.createdAt,
  };
}

function getRoom(roomId = DEFAULT_ROOM_ID) {
  const key = String(roomId || DEFAULT_ROOM_ID);
  let room = rooms.get(key);

  if (!room) {
    room = {
      roomId: key,
      roundNo: 0,
      round: null,
      lastRound: null,
      history: [],
      allCashoutRoundCount: 0,
      timers: new Set(),
      startedAt: new Date(),
    };
    rooms.set(key, room);
  }

  if (!room.round) scheduleNextRound(room, 0);
  advanceRoom(room);
  return room;
}

function clearRoomTimers(room) {
  for (const timer of room.timers || []) clearTimeout(timer);
  room.timers.clear();
}

function setRoomTimer(room, fn, ms) {
  const timer = setTimeout(() => {
    room.timers.delete(timer);
    fn();
  }, ms);
  room.timers.add(timer);
  return timer;
}

function scheduleNextRound(room, delayMs = NEXT_ROUND_DELAY_MS) {
  clearRoomTimers(room);
  setRoomTimer(room, () => startBettingRound(room), Math.max(0, delayMs));
}

function startBettingRound(room) {
  clearRoomTimers(room);
  room.roundNo += 1;
  const now = Date.now();
  room.round = {
    id: makeId(),
    no: room.roundNo,
    state: 'betting',
    players: new Map(),
    pendingBets: new Set(),
    currentMultiplier: 1,
    crashPoint: null,
    hypeMode: false,
    hypeTarget: null,
    hypeDecided: false,
    multiplierFrom: 1,
    crashDurationMs: null,
    crashAtMs: null,
    startedAtMs: null,
    betStartedAtMs: now,
    bettingEndsAtMs: now + BET_SECONDS * 1000,
    endedAtMs: null,
    createdAt: new Date().toISOString(),
  };

  setRoomTimer(room, () => closeBettingRound(room).catch((err) => {
    console.error('WEB_CRASH_CLOSE_FAILED:', err?.stack || err?.message || err);
    finishRound(room, 'error');
  }), BET_SECONDS * 1000);
}

async function closeBettingRound(room) {
  const round = room.round;
  if (!round || round.state !== 'betting') return;
  clearRoomTimers(room);

  if (!round.players.size) {
    round.state = 'no_bets';
    round.endedAtMs = Date.now();
    room.lastRound = snapshotRound(round);
    room.round = null;
    return scheduleNextRound(room, NEXT_ROUND_DELAY_MS);
  }

  const treasury = await getTreasury();
  const now = Date.now();
  round.crashPoint = generateCrashPoint(round, Number(treasury?.ownerBalance || 0));
  round.currentMultiplier = 1;
  round.multiplierFrom = 1;
  round.crashDurationMs = normalCrashDurationMs(round.crashPoint);
  round.startedAtMs = now;
  round.crashAtMs = now + round.crashDurationMs;
  round.state = 'running';

  // A timer is kept only as a safety net. Status/cashout also computes from Date.now(), so the UI cannot freeze.
  setRoomTimer(room, () => {
    advanceRoom(room);
    if (room.round === round && round.state === 'running') finishRound(room, 'crashed');
  }, round.crashDurationMs + 50);
}

function finishRound(room, result = 'crashed') {
  const round = room.round;
  if (!round) return;

  clearRoomTimers(room);
  round.state = result === 'error' ? 'error' : 'crashed';
  round.endedAtMs = Date.now();
  round.currentMultiplier = round2(currentTarget(round) || round.currentMultiplier || 1);
  pushHistory(room, round);
  room.lastRound = snapshotRound(round);
  room.round = null;
  scheduleNextRound(room, NEXT_ROUND_DELAY_MS);
}

async function capCrashPayout(player, rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBet = Math.floor(Number(player.bet || 0) * PAYOUT_MAX_MULTIPLIER);
  const hardMax = Math.max(Number(player.bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
}

function publicPlayer(player, selfId = null) {
  return {
    userId: player.userId === selfId ? player.userId : undefined,
    me: player.userId === selfId,
    name: playerNameSafe(player.tg),
    username: player.tg?.username || null,
    initials: initials(player.tg),
    bet: Number(player.bet || 0),
    cashedOut: !!player.cashedOut,
    cashoutMultiplier: Number(player.cashoutMultiplier || 0),
    payout: Number(player.payout || 0),
    status: player.cashedOut ? 'cashed_out' : 'playing',
  };
}

function playerNameSafe(tg) {
  return publicName(tg).slice(0, 32);
}

function initials(tg) {
  const name = publicName(tg).trim();
  const pieces = name.split(/\s+/).filter(Boolean);
  const value = pieces.length >= 2 ? pieces[0][0] + pieces[1][0] : name.slice(0, 2);
  return String(value || 'P').toUpperCase();
}

function getMe(round, userId) {
  const player = round?.players?.get?.(userId);
  if (!player) return { inRound: false };
  return {
    inRound: true,
    bet: Number(player.bet || 0),
    cashedOut: !!player.cashedOut,
    payout: Number(player.payout || 0),
    cashoutMultiplier: Number(player.cashoutMultiplier || 0),
    canCashout: round.state === 'running' && !player.cashedOut && round.currentMultiplier >= MIN_CASHOUT_MULTIPLIER,
  };
}

function publicRound(round, userId, source = 'current') {
  if (!round) return null;
  const players = [...round.players.values()]
    .sort((a, b) => {
      if (a.cashedOut !== b.cashedOut) return a.cashedOut ? -1 : 1;
      return Number(b.payout || b.bet || 0) - Number(a.payout || a.bet || 0);
    })
    .slice(0, DISPLAY_PLAYER_LIMIT)
    .map((player) => publicPlayer(player, userId));

  const secondsLeft = round.state === 'betting'
    ? Math.max(0, Math.ceil((round.bettingEndsAtMs - Date.now()) / 1000))
    : 0;

  return {
    source,
    id: round.id,
    no: round.no,
    state: round.state,
    phase: round.state,
    coin: COIN,
    multiplier: Number(round.currentMultiplier || 1),
    crashPoint: round.state === 'crashed' || round.state === 'no_bets' || source === 'last' ? Number(round.currentMultiplier || round.crashPoint || 1) : null,
    startedAtMs: round.startedAtMs || null,
    // Do not expose hidden crashAt/crashDuration/target while running.
    crashAtMs: round.state === 'crashed' || source === 'last' ? round.crashAtMs || null : null,
    crashDurationMs: round.state === 'crashed' || source === 'last' ? round.crashDurationMs || null : null,
    multiplierFrom: round.state === 'crashed' || source === 'last' ? round.multiplierFrom || 1 : null,
    endedAtMs: round.endedAtMs || null,
    betStartedAtMs: round.betStartedAtMs || null,
    bettingEndsAtMs: round.bettingEndsAtMs || null,
    betSeconds: BET_SECONDS,
    secondsLeft,
    nextRoundDelayMs: NEXT_ROUND_DELAY_MS,
    minBet: MIN_BET,
    maxBet: MAX_BET,
    minCashoutMultiplier: MIN_CASHOUT_MULTIPLIER,
    maxPayoutMultiplier: PAYOUT_MAX_MULTIPLIER,
    players,
    playerCount: round.players.size,
    cashoutCount: cashoutCount(round),
    leftCount: activePlayers(round).length,
    totalBet: totalBet(round),
    totalPaid: totalPaid(round),
    houseNet: totalBet(round) - totalPaid(round),
    hypeMode: !!round.hypeMode,
    hypeTarget: round.state === 'crashed' || source === 'last' ? round.hypeTarget || null : null,
    me: getMe(round, userId),
  };
}

async function getWebCrashStatus(userId, roomId = DEFAULT_ROOM_ID) {
  const finalUserId = cleanUserId(userId);
  if (!finalUserId) throw new Error('INVALID_USER');
  const room = getRoom(roomId);
  advanceRoom(room);
  const round = room.round;
  const current = round ? publicRound(round, finalUserId, 'current') : null;
  const last = room.lastRound ? publicRound(room.lastRound, finalUserId, 'last') : null;

  return {
    active: !!round,
    roomId: room.roomId,
    coin: COIN,
    round: current,
    lastRound: last,
    history: room.history || [],
    serverNowMs: Date.now(),
  };
}

async function placeWebCrashBet({ userId, user, bet, roomId = DEFAULT_ROOM_ID }) {
  const finalUserId = cleanUserId(userId);
  const amount = parseBet(bet);
  if (!finalUserId) throw new Error('INVALID_USER');
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    const err = new Error('BET_RANGE');
    err.minBet = MIN_BET;
    err.maxBet = MAX_BET;
    throw err;
  }

  const room = getRoom(roomId);
  advanceRoom(room);
  const round = room.round;
  if (!round || round.state !== 'betting') throw new Error('NOT_BETTING');
  if (round.players.has(finalUserId) || round.pendingBets.has(finalUserId)) throw new Error('ALREADY_BET');
  if (round.players.size >= MAX_PLAYERS) throw new Error('ROUND_FULL');

  round.pendingBets.add(finalUserId);

  try {
    const doc = await getUser(finalUserId);
    if (!doc) throw new Error('USER_NOT_FOUND');
    if (Number(doc.balance || 0) < amount) throw new Error('USER_INSUFFICIENT');

    await userPayToTreasury(finalUserId, amount, {
      type: 'web_crash_bet',
      source: 'miniapp_multiplayer',
      roomId: room.roomId,
      roundId: round.id,
      roundNo: round.no,
    });

    round.players.set(finalUserId, {
      userId: finalUserId,
      tg: {
        id: finalUserId,
        first_name: user?.first_name || user?.firstName || null,
        last_name: user?.last_name || user?.lastName || null,
        username: user?.username || null,
      },
      bet: amount,
      cashedOut: false,
      cashingOut: false,
      cashoutMultiplier: 0,
      payout: 0,
      joinedAt: new Date().toISOString(),
    });

    const updated = await getUser(finalUserId);
    return {
      balance: Number(updated?.balance || 0),
      ...await getWebCrashStatus(finalUserId, room.roomId),
    };
  } finally {
    round.pendingBets.delete(finalUserId);
  }
}

async function cashoutWebCrash({ userId, roomId = DEFAULT_ROOM_ID }) {
  const finalUserId = cleanUserId(userId);
  if (!finalUserId) throw new Error('INVALID_USER');

  const room = getRoom(roomId);
  advanceRoom(room);
  const round = room.round;
  if (!round || round.state !== 'running') throw new Error('NO_ACTIVE_CRASH');

  const player = round.players.get(finalUserId);
  if (!player) throw new Error('NOT_IN_ROUND');
  if (player.cashedOut) throw new Error('ALREADY_CASHED_OUT');
  if (player.cashingOut) throw new Error('CASHOUT_PROCESSING');
  if (round.currentMultiplier >= currentTarget(round) && !round.hypeMode) throw new Error('CRASHED');
  if (round.currentMultiplier < MIN_CASHOUT_MULTIPLIER && !round.hypeMode) {
    const err = new Error('CASHOUT_LOCKED');
    err.minMultiplier = MIN_CASHOUT_MULTIPLIER;
    throw err;
  }

  player.cashingOut = true;
  try {
    const effectiveMultiplier = Math.min(round.currentMultiplier, PAYOUT_MAX_MULTIPLIER);
    const rawPayout = Math.floor(player.bet * effectiveMultiplier);
    const payout = await capCrashPayout(player, rawPayout);

    await treasuryPayToUser(finalUserId, payout, {
      type: 'web_crash_win',
      source: 'miniapp_multiplayer',
      roomId: room.roomId,
      roundId: round.id,
      roundNo: round.no,
      bet: player.bet,
      payout,
      rawPayout,
      multiplier: effectiveMultiplier,
      shownMultiplier: round.currentMultiplier,
    });

    player.cashedOut = true;
    player.cashoutMultiplier = effectiveMultiplier;
    player.payout = payout;
    player.cashedOutAt = new Date().toISOString();

    if (allPlayersCashedOut(round) && !round.hypeMode && !round.hypeDecided) {
      round.hypeDecided = true;
      if (shouldStartHype(room)) {
        clearRoomTimers(room);
        round.hypeMode = true;
        round.hypeTarget = generateHypeTarget();
        round.multiplierFrom = Math.max(round.currentMultiplier, MIN_CASHOUT_MULTIPLIER);
        round.startedAtMs = Date.now();
        round.crashDurationMs = hypeDurationMs(round.multiplierFrom, round.hypeTarget);
        round.crashAtMs = round.startedAtMs + round.crashDurationMs;
        setRoomTimer(room, () => {
          advanceRoom(room);
          if (room.round === round && round.state === 'running') finishRound(room, 'crashed');
        }, round.crashDurationMs + 50);
      }
      // Most all-cashout rounds keep the original crash point and do not jump to big hype.
    }

    const updated = await getUser(finalUserId);
    return {
      balance: Number(updated?.balance || 0),
      payout,
      effectiveMultiplier,
      rawPayout,
      ...await getWebCrashStatus(finalUserId, room.roomId),
    };
  } finally {
    player.cashingOut = false;
  }
}

function startWebCrashLoop(roomId = DEFAULT_ROOM_ID) {
  return getRoom(roomId);
}

module.exports = {
  startWebCrashLoop,
  getWebCrashStatus,
  placeWebCrashBet,
  cashoutWebCrash,
  // Backward compatible name used by older Mini App route versions.
  startWebCrash: placeWebCrashBet,
  _private: {
    generateCrashPoint,
    generateHypeTarget,
    shouldStartHype,
    normalCrashDurationMs,
    multiplierAtElapsed,
    computeRoundMultiplier,
    round2,
    rooms,
  },
};
