'use strict';

const { ensureTreasury, isOwner } = require('../../services/treasuryService');
const {
  startBroadcast,
  stopBroadcast,
  SEND_CONCURRENCY,
  FREE_BROADCAST_RATE,
} = require('../../services/broadcastService');
const { replyHTML, editByIds } = require('../../utils/telegram');

function getReplySource(ctx) {
  return ctx.message?.reply_to_message || null;
}

function getCommandText(ctx) {
  return String(ctx.message?.text || '')
    .replace(/^\/broadcast(@\w+)?\s*/i, '')
    .trim();
}

module.exports = (bot) => {
  bot.command('broadcast', async (ctx) => {
    const t = await ensureTreasury();
    if (!isOwner(ctx, t)) return replyHTML(ctx, '⛔ Owner only.');

    const commandText = getCommandText(ctx);
    const reply = getReplySource(ctx);

    // Reply to any Telegram message with no typed text to copy it exactly.
    // This preserves media, caption/entities and inline/reply buttons.
    const copySource = !commandText && reply ? reply : null;
    const text = commandText || (reply?.text || reply?.caption || '');

    if (!copySource && !text) {
      return replyHTML(
        ctx,
        'Usage: <code>/broadcast message</code>\n' +
          'or reply to any message with <code>/broadcast</code> to copy it exactly.'
      );
    }

    let progress = null;

    try {
      progress = await replyHTML(
        ctx,
        copySource
          ? '📣 Copy broadcast preparing…'
          : '📣 Text broadcast preparing…'
      );

      const result = await startBroadcast(
        bot,
        ctx.chat.id,
        text,
        async (p) => {
          if (!progress?.message_id) return;

          await editByIds(
            bot,
            ctx.chat.id,
            progress.message_id,
            '📣 <b>Broadcast Progress</b>\n' +
              '━━━━━━━━━━━━━━\n' +
              'Mode: <b>' + (p.mode === 'copy' ? 'COPY' : 'TEXT') + '</b>\n' +
              'Users: <b>' + p.userSent + '</b> · Approved Groups: <b>' + p.groupSent + '</b>\n' +
              'Processed: <b>' + p.processed + '</b>/<b>' + p.total + '</b>\n' +
              'Sent: <b>' + p.ok + '</b>\n' +
              'Skipped: <b>' + p.skipped + '</b>\n' +
              'Failed: <b>' + p.fail + '</b>'
          );
        },
        { copyMessage: copySource }
      );

      const modeText = result.mode === 'copy' ? 'COPY ✅' : 'TEXT';
      if (progress?.message_id) {
        await editByIds(
          bot,
          ctx.chat.id,
          progress.message_id,
          '✅ <b>Broadcast done</b>\n' +
            '━━━━━━━━━━━━━━\n' +
            'Mode: <b>' + modeText + '</b>\n' +
            'Users sent: <b>' + result.userSent + '</b>\n' +
            'Approved groups sent: <b>' + result.groupSent + '</b>\n' +
            'Sent: <b>' + result.ok + '</b>\n' +
            'Skipped: <b>' + result.skipped + '</b>\n' +
            'Failed: <b>' + result.fail + '</b>\n' +
            'Processed: <b>' + result.processed + '</b>/<b>' + result.total + '</b>\n' +
            'Rate cap: <b>' + FREE_BROADCAST_RATE + '/sec</b> · Workers: <b>' + (result.concurrency || SEND_CONCURRENCY) + '</b>' +
            (result.cancelled ? '\n🛑 <b>Stopped</b>' : '')
        );
      } else {
        await replyHTML(
          ctx,
          '✅ Broadcast done · Mode: <b>' + modeText + '</b> · ' +
            'Users: <b>' + result.userSent + '</b> · Approved Groups: <b>' + result.groupSent + '</b> · ' +
            'Sent: <b>' + result.ok + '</b> · Skipped: <b>' + result.skipped + '</b> · Failed: <b>' + result.fail + '</b>'
        );
      }
    } catch (e) {
      const message =
        e.message === 'BROADCAST_RUNNING'
          ? '⚠️ Broadcast တစ်ခု run နေပါတယ်။'
          : e.message === 'BROADCAST_SOURCE_INVALID'
            ? '⚠️ Copy source message မမှန်ကန်ပါ။'
            : '⚠️ Broadcast error';

      if (progress?.message_id) {
        await editByIds(bot, ctx.chat.id, progress.message_id, message);
      } else {
        await replyHTML(ctx, message);
      }
    }
  });

  bot.command('broadcastend', async (ctx) => {
    const t = await ensureTreasury();
    if (!isOwner(ctx, t)) return replyHTML(ctx, '⛔ Owner only.');

    return replyHTML(
      ctx,
      stopBroadcast()
        ? '🛑 Broadcast stopping…'
        : 'ℹ️ Broadcast မရှိပါ။'
    );
  });
};
