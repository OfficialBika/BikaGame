const userModel = require('../models/userModel');
const groupModel = require('../models/groupModel');
const treasuryModel = require('../models/treasuryModel');
const { safeTelegram } = require('../utils/telegram');
const { escHtml } = require('../utils/format');

const FREE_BROADCAST_RATE = 25;
const MIN_INTERVAL_MS = Math.ceil(1000 / FREE_BROADCAST_RATE);
const PROGRESS_EVERY = 25;
let current = null;

function isPermanentRecipientError(err) {
  const m = String(err?.message || err).toLowerCase();
  return m.includes('forbidden') ||
    m.includes('blocked') ||
    m.includes('chat not found') ||
    m.includes('kicked') ||
    m.includes('user is deactivated');
}

function createPacer(rate = FREE_BROADCAST_RATE) {
  const interval = Math.max(1, Math.ceil(1000 / rate));
  let nextAt = 0;
  return async function pace() {
    const now = Date.now();
    const wait = Math.max(0, nextAt - now);
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    nextAt = Math.max(nextAt, Date.now()) + interval;
  };
}

function isCancelled(runId) {
  return !current || current.id !== runId || current.cancelled;
}

async function updateBroadcastState(fields) {
  await treasuryModel.collection().updateOne(
    { key: 'treasury' },
    { $set: { ...fields, updatedAt: new Date() } }
  );
}

async function startBroadcast(bot, ownerChatId, text, progressCb) {
  if (current && !current.cancelled) throw new Error('BROADCAST_RUNNING');

  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  current = { id: runId, cancelled: false };

  try {
    await updateBroadcastState({
      broadcastRunning: true,
      broadcastRunId: runId,
      broadcastStartedAt: new Date(),
      broadcastOwnerChatId: Number(ownerChatId) || ownerChatId,
    });

    const message = `📣 <b>BIKA Broadcast</b>\n━━━━━━━━━━━━━━\n${escHtml(text)}`;
    const seen = new Set();
    const targets = [];

    const collectTargets = async (cursor, kind) => {
      for await (const doc of cursor) {
        const id = Number(doc?.userId ?? doc?.groupId);
        if (Number.isFinite(id) && !seen.has(id)) {
          seen.add(id);
          targets.push({ chatId: id, kind });
        }
        if (isCancelled(runId)) break;
      }
    };

    await collectTargets(
      userModel.collection().find({}, { projection: { userId: 1 } }),
      'user'
    );

    if (!isCancelled(runId)) {
      await collectTargets(
        groupModel.collection().find(
          { approvalStatus: 'approved' },
          { projection: { groupId: 1 } }
        ),
        'group'
      );
    }

    let ok = 0;
    let fail = 0;
    let skipped = 0;
    let userSent = 0;
    let groupSent = 0;
    let processed = 0;
    const pace = createPacer();

    for (const target of targets) {
      if (isCancelled(runId)) break;

      await pace();

      try {
        await safeTelegram(
          () => bot.telegram.sendMessage(
            target.chatId,
            message,
            { parse_mode: 'HTML', disable_web_page_preview: true }
          ),
          { maxRetries: 4 }
        );

        ok += 1;
        if (target.kind === 'user') userSent += 1;
        else groupSent += 1;
      } catch (err) {
        if (isPermanentRecipientError(err)) skipped += 1;
        else fail += 1;
      }

      processed += 1;

      if (processed % PROGRESS_EVERY === 0 && progressCb) {
        await progressCb({
          runId,
          processed,
          total: targets.length,
          ok,
          fail,
          skipped,
          userSent,
          groupSent,
        });
      }
    }

    const cancelled = isCancelled(runId);
    return {
      runId,
      ok,
      fail,
      skipped,
      userSent,
      groupSent,
      processed,
      total: targets.length,
      cancelled,
    };
  } finally {
    if (current?.id === runId) current = null;
    try {
      await updateBroadcastState({
        broadcastRunning: false,
        broadcastRunId: null,
        broadcastStartedAt: null,
        broadcastOwnerChatId: null,
      });
    } catch (_) {
      // The broadcast result must not be hidden by a cleanup-state DB failure.
    }
  }
}

function stopBroadcast() {
  if (!current) return false;
  current.cancelled = true;
  return true;
}

function getBroadcastState() {
  return current
    ? { runId: current.id, cancelled: current.cancelled }
    : null;
}

module.exports = {
  startBroadcast,
  stopBroadcast,
  getBroadcastState,
  FREE_BROADCAST_RATE,
  MIN_INTERVAL_MS,
};