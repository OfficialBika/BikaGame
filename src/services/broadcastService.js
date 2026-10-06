'use strict';

const userModel = require('../models/userModel');
const groupModel = require('../models/groupModel');
const treasuryModel = require('../models/treasuryModel');
const { safeTelegram } = require('../utils/telegram');
const { escHtml } = require('../utils/format');

const FREE_BROADCAST_RATE = 25;
const MIN_INTERVAL_MS = Math.ceil(1000 / FREE_BROADCAST_RATE);
const PROGRESS_EVERY = 25;
const SEND_CONCURRENCY = Math.max(
  1,
  Math.min(20, Number(process.env.BROADCAST_CONCURRENCY || 8))
);
const BROADCAST_LOCK_STALE_MS = Math.max(
  60_000,
  Number(process.env.BROADCAST_LOCK_STALE_MS || 15 * 60_000)
);
const ALLOW_PAID_BROADCAST = /^(1|true|yes|on)$/i.test(
  String(process.env.BROADCAST_ALLOW_PAID || '')
);

let current = null;

function isPermanentRecipientError(err) {
  const m = String(err?.message || err).toLowerCase();
  return m.includes('forbidden') ||
    m.includes('blocked') ||
    m.includes('chat not found') ||
    m.includes('kicked') ||
    m.includes('user is deactivated') ||
    m.includes('bot was blocked by the user') ||
    m.includes('user not found');
}

function createPacer(rate = FREE_BROADCAST_RATE) {
  const interval = Math.max(1, Math.ceil(1000 / rate));
  let scheduledAt = 0;
  let chain = Promise.resolve();

  return function pace() {
    const slot = chain.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, scheduledAt - now);
      scheduledAt = Math.max(scheduledAt, now) + interval;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    });
    chain = slot.catch(() => {});
    return slot;
  };
}

function isCancelled(runId) {
  return !current || current.id !== runId || current.cancelled;
}

function unwrapFindOneAndUpdate(result) {
  return result?.value !== undefined ? result.value : result;
}

async function updateBroadcastState(fields) {
  await treasuryModel.collection().updateOne(
    { key: 'treasury' },
    { $set: { ...fields, updatedAt: new Date() } }
  );
}

async function acquireBroadcastLock(runId, ownerChatId) {
  const staleBefore = new Date(Date.now() - BROADCAST_LOCK_STALE_MS);
  const result = await treasuryModel.collection().findOneAndUpdate(
    {
      key: 'treasury',
      $or: [
        { broadcastRunning: { $ne: true } },
        {
          broadcastRunning: true,
          broadcastHeartbeatAt: { $lt: staleBefore },
        },
        {
          broadcastRunning: true,
          broadcastHeartbeatAt: { $exists: false },
        },
      ],
    },
    {
      $set: {
        broadcastRunning: true,
        broadcastRunId: runId,
        broadcastStartedAt: new Date(),
        broadcastHeartbeatAt: new Date(),
        broadcastOwnerChatId: Number(ownerChatId) || ownerChatId,
      },
    },
    { returnDocument: 'after' }
  );

  if (!unwrapFindOneAndUpdate(result)) {
    throw new Error('BROADCAST_RUNNING');
  }
}

function copyOptions(sourceMessage) {
  const extra = {};

  if (sourceMessage?.reply_markup) {
    extra.reply_markup = JSON.parse(JSON.stringify(sourceMessage.reply_markup));
  }

  if (ALLOW_PAID_BROADCAST) {
    extra.allow_paid_broadcast = true;
  }

  return extra;
}

function describeCopySource(sourceMessage, sourceChatId) {
  if (!sourceMessage?.message_id || sourceChatId == null) return null;
  return {
    sourceChatId,
    sourceMessageId: sourceMessage.message_id,
  };
}

async function sendBroadcastTarget(bot, target, { source, formattedText }) {
  if (source) {
    return safeTelegram(
      () => bot.telegram.copyMessage(
        target.chatId,
        source.sourceChatId,
        source.sourceMessageId,
        copyOptions(source.message)
      ),
      { maxRetries: 4 }
    );
  }

  return safeTelegram(
    () => bot.telegram.sendMessage(
      target.chatId,
      formattedText,
      {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...(ALLOW_PAID_BROADCAST ? { allow_paid_broadcast: true } : {}),
      }
    ),
    { maxRetries: 4 }
  );
}

async function collectTargets() {
  const seen = new Set();
  const targets = [];

  const collect = async (cursor, kind) => {
    for await (const doc of cursor) {
      const rawId = kind === 'user' ? doc?.userId : doc?.groupId;
      const id = Number(rawId);

      if (Number.isFinite(id) && !seen.has(id)) {
        seen.add(id);
        targets.push({ chatId: id, kind });
      }
    }
  };

  await Promise.all([
    collect(
      userModel.collection().find({}, { projection: { userId: 1 } }),
      'user'
    ),
    collect(
      groupModel.collection().find(
        { approvalStatus: 'approved' },
        { projection: { groupId: 1 } }
      ),
      'group'
    ),
  ]);

  return targets;
}

async function startBroadcast(bot, ownerChatId, text, progressCb, options = {}) {
  if (current && !current.cancelled) throw new Error('BROADCAST_RUNNING');

  const sourceMessage = options.copyMessage || null;
  const source = describeCopySource(sourceMessage, ownerChatId);
  if (sourceMessage && !source) {
    throw new Error('BROADCAST_SOURCE_INVALID');
  }

  const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  current = { id: runId, cancelled: false };
  let lockAcquired = false;

  try {
    await acquireBroadcastLock(runId, ownerChatId);
    lockAcquired = true;

    const formattedText = `📣 <b>BIKA Broadcast</b>\n━━━━━━━━━━━━━━\n${escHtml(text || '')}`;
    const targets = await collectTargets();

    let ok = 0;
    let fail = 0;
    let skipped = 0;
    let userSent = 0;
    let groupSent = 0;
    let processed = 0;

    const pace = createPacer();
    let progressChain = Promise.resolve();

    const snapshot = () => ({
      runId,
      mode: source ? 'copy' : 'text',
      processed,
      total: targets.length,
      ok,
      fail,
      skipped,
      userSent,
      groupSent,
    });

    const queueProgress = () => {
      if (processed % PROGRESS_EVERY !== 0) return;

      if (progressCb) {
        const state = snapshot();
        progressChain = progressChain
          .then(() => progressCb(state))
          .catch(() => {});
      }

      void updateBroadcastState({
        broadcastHeartbeatAt: new Date(),
        broadcastProcessed: processed,
        broadcastTotal: targets.length,
        broadcastSent: ok,
        broadcastFailed: fail,
        broadcastSkipped: skipped,
      }).catch(() => {});
    };

    let cursor = 0;
    async function worker() {
      while (true) {
        if (isCancelled(runId)) return;

        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;

        const target = targets[index];

        try {
          await pace();
          if (isCancelled(runId)) return;

          await sendBroadcastTarget(bot, target, {
            source: source ? { ...source, message: sourceMessage } : null,
            formattedText,
          });

          ok += 1;
          if (target.kind === 'user') userSent += 1;
          else groupSent += 1;
        } catch (err) {
          if (isPermanentRecipientError(err)) skipped += 1;
          else fail += 1;
        } finally {
          processed += 1;
          queueProgress();
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(SEND_CONCURRENCY, Math.max(1, targets.length)) },
      () => worker()
    );

    await Promise.all(workers);
    await progressChain;

    const cancelled = isCancelled(runId);

    return {
      ...snapshot(),
      cancelled,
      concurrency: Math.min(SEND_CONCURRENCY, Math.max(1, targets.length)),
      paidBroadcast: ALLOW_PAID_BROADCAST,
    };
  } finally {
    if (current?.id === runId) current = null;

    if (lockAcquired) {
      try {
        await treasuryModel.collection().updateOne(
          { key: 'treasury', broadcastRunId: runId },
          {
            $set: {
              broadcastRunning: false,
              broadcastRunId: null,
              broadcastStartedAt: null,
              broadcastHeartbeatAt: null,
              broadcastOwnerChatId: null,
              broadcastProcessed: null,
              broadcastTotal: null,
              broadcastSent: null,
              broadcastFailed: null,
              broadcastSkipped: null,
              updatedAt: new Date(),
            },
          }
        );
      } catch (_) {
        // Do not hide the broadcast result because cleanup-state persistence failed.
      }
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
  SEND_CONCURRENCY,
};
