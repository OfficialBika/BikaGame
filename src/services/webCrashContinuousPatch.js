'use strict';

/*
 * Keeps Rocket rounds alive even when a betting window receives zero bets.
 * The canonical crash service remains the source of truth for balances,
 * cashouts and round math; this adapter only changes the empty-round lifecycle.
 */
const crash = require('./webCrashService');
const { getTreasury } = require('./treasuryService');

const rooms = crash._private?.rooms;
const roomWatchers = new Map();
const scheduledRounds = new WeakSet();
const WATCH_MS = Math.max(50, Number(process.env.WEB_CRASH_EMPTY_ROUND_WATCH_MS || 100));
const PRE_CLOSE_MS = 35;

function clearRoomTimers(room) {
  for (const timer of room?.timers || []) clearTimeout(timer);
  if (room?.timers) room.timers.clear();
}

async function promoteEmptyBettingRound(room, expectedRound) {
  const round = room?.round;
  if (!round || round !== expectedRound || round.state !== 'betting') return false;
  if (Date.now() < Number(round.bettingEndsAtMs || 0)) return false;

  clearRoomTimers(room);
  const treasury = await getTreasury().catch(() => null);
  const rocketRtp = await crash.getRocketRtp().catch(() => 76);
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

function armRound(room) {
  const round = room?.round;
  if (!round || round.state !== 'betting' || scheduledRounds.has(round)) return;
  scheduledRounds.add(round);

  const remaining = Math.max(0, Number(round.bettingEndsAtMs || 0) - Date.now() - PRE_CLOSE_MS);
  setTimeout(() => {
    promoteEmptyBettingRound(room, round).catch((err) => {
      console.error('WEB_CRASH_EMPTY_ROUND_PATCH:', err?.stack || err?.message || err);
    });
  }, remaining);
}

function startWatcher(roomId) {
  const key = String(roomId || 'global');
  if (roomWatchers.has(key)) return;
  const timer = setInterval(() => {
    const room = rooms?.get(key);
    if (room?.round?.state === 'betting') armRound(room);
  }, WATCH_MS);
  roomWatchers.set(key, timer);
}

const originalStart = crash.startWebCrashLoop;
crash.startWebCrashLoop = function patchedStartWebCrashLoop(roomId = 'global') {
  const room = originalStart(roomId);
  startWatcher(roomId);
  armRound(room);
  return room;
};

module.exports = crash;
