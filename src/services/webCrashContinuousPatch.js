'use strict';

/*
 * Keeps the Rocket room alive even when a betting window receives zero bets.
 * The canonical crash service remains the source of truth for balances,
 * cashouts and round math; this adapter only changes the empty-round lifecycle.
 */
const crash = require('./webCrashService');
const { getTreasury } = require('./treasuryService');

const rooms = crash._private?.rooms;
const ensureTimers = new Map();
const BET_TICK_MS = Math.max(100, Number(process.env.WEB_CRASH_EMPTY_ROUND_TICK_MS || 250));

function clearRoomTimers(room) {
  for (const timer of room?.timers || []) clearTimeout(timer);
  if (room?.timers) room.timers.clear();
}

async function promoteEmptyBettingRound(room) {
  const round = room?.round;
  if (!round || round.state !== 'betting' || Date.now() < Number(round.bettingEndsAtMs || 0)) return false;

  clearRoomTimers(room);
  const treasury = await getTreasury().catch(() => null);
  const rocketRtp = await crash.getRocketRtp().catch(() => null);
  const target = crash._private.generateCrashPoint(
    round,
    Number(treasury?.ownerBalance || 0),
    Number(rocketRtp || 76)
  );
  const now = Date.now();

  round.rocketRtp = rocketRtp;
  round.crashPoint = target;
  round.currentMultiplier = 1;
  round.multiplierFrom = 1;
  round.crashDurationMs = crash._private.normalCrashDurationMs(target);
  round.startedAtMs = now;
  round.crashAtMs = now + round.crashDurationMs;
  round.state = 'running';
  return true;
}

function startTicker(roomId) {
  const key = String(roomId || 'global');
  if (ensureTimers.has(key)) return;
  const timer = setInterval(async () => {
    try {
      const room = rooms?.get(key);
      if (!room?.round) return;
      if (room.round.state === 'betting') await promoteEmptyBettingRound(room);
    } catch (err) {
      console.error('WEB_CRASH_EMPTY_ROUND_PATCH:', err?.stack || err?.message || err);
    }
  }, BET_TICK_MS);
  ensureTimers.set(key, timer);
}

const originalStart = crash.startWebCrashLoop;
crash.startWebCrashLoop = function patchedStartWebCrashLoop(roomId = 'global') {
  const room = originalStart(roomId);
  startTicker(roomId);
  return room;
};

module.exports = crash;
