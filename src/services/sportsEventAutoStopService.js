'use strict';

const { events } = require('./sportsEventService');
const { logger } = require('../utils/logger');

const POLL_INTERVAL_MS = 1000;
const LEASE_MS = 60000;
let timer = null;
let running = false;

function html(value) {
  return String(value || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function message(event) {
  const aliases = (event.teams || []).map((team) => '<code>' + html(team.alias) + '</code>').join(' / ');
  return [
    '🔒 <b>AUTO STOPBET</b>',
    '━━━━━━━━━━━━━━━━',
    '🏆 <b>' + html(event.title) + '</b>',
    '⏰ ပွဲစချိန်ရောက်ရှိပါပြီ။ လောင်းကြေးအသစ်များကို ပိတ်လိုက်ပါပြီ။',
    '',
    '⏳ Owner သည် .betwin alias (' + aliases + ') ဖြင့် အနိုင်ရလဒ် သတ်မှတ်နိုင်ပါပြီ။'
  ].join('\\n');
}

async function stopDueEvents() {
  for (let i = 0; i < 100; i += 1) {
    const result = await events().findOneAndUpdate(
      {
        status: 'open',
        kickoffAt: { $type: 'date' },
        $expr: { $lte: ['$kickoffAt', '$$NOW'] }
      },
      [{
        $set: {
          status: 'stopped',
          stopReason: 'auto',
          stoppedAt: '$$NOW',
          updatedAt: '$$NOW',
          autoStopNotificationStatus: 'pending'
        }
      }],
      { sort: { kickoffAt: 1 }, returnDocument: 'after' }
    );
    const event = result?.value ?? result;
    if (!event) break;
  }
}

async function notifyPending(bot) {
  for (let i = 0; i < 20; i += 1) {
    const now = new Date();
    const result = await events().findOneAndUpdate(
      {
        status: 'stopped',
        stopReason: 'auto',
        $or: [
          { autoStopNotificationStatus: 'pending' },
          { autoStopNotificationStatus: 'sending', autoStopNotificationLeaseUntil: { $lte: now } }
        ]
      },
      {
        $set: {
          autoStopNotificationStatus: 'sending',
          autoStopNotificationLeaseUntil: new Date(now.getTime() + LEASE_MS)
        },
        $inc: { autoStopNotificationAttempts: 1 }
      },
      { sort: { stoppedAt: 1 }, returnDocument: 'after' }
    );
    const event = result?.value ?? result;
    if (!event) break;
    try {
      await bot.telegram.sendMessage(
        String(event.commentChatId),
        message(event),
        { parse_mode: 'HTML', disable_web_page_preview: true, reply_to_message_id: Number(event.threadRootMessageId), allow_sending_without_reply: true }
      );
      await events().updateOne(
        { _id: event._id, autoStopNotificationStatus: 'sending' },
        { $set: { autoStopNotificationStatus: 'sent', autoStopNotifiedAt: new Date(), updatedAt: new Date() }, $unset: { autoStopNotificationLeaseUntil: '' } }
      );
    } catch (err) {
      const error = String(err?.message || err).slice(0, 500);
      logger.warn('Sports auto-stop notification failed; will retry: ' + error);
      await events().updateOne(
        { _id: event._id, autoStopNotificationStatus: 'sending' },
        { $set: { autoStopNotificationStatus: 'pending', autoStopNotificationLastError: error, updatedAt: new Date() }, $unset: { autoStopNotificationLeaseUntil: '' } }
      );
    }
  }
}

async function tick(bot) {
  if (running) return;
  running = true;
  try {
    await stopDueEvents();
    await notifyPending(bot);
  } catch (err) {
    logger.error('Sports auto-stop scheduler tick failed', err);
  } finally {
    running = false;
  }
}

async function startSportsEventAutoStop(bot) {
  if (timer) return;
  await events().createIndex({ status: 1, kickoffAt: 1 }, { name: 'sports_events_auto_stop_due' });
  await tick(bot);
  timer = setInterval(() => tick(bot), POLL_INTERVAL_MS);
  timer.unref?.();
  logger.info('Sports event auto-stop scheduler started.');
}

function stopSportsEventAutoStop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startSportsEventAutoStop, stopSportsEventAutoStop };
