const { ensureTreasury, isOwner } = require('../../services/treasuryService');
const { startBroadcast, stopBroadcast } = require('../../services/broadcastService');
const { replyHTML, editByIds } = require('../../utils/telegram');

module.exports = (bot) => {
  bot.command('broadcast', async (ctx) => {
    const t = await ensureTreasury();
    if (!isOwner(ctx, t)) return replyHTML(ctx, '⛔ Owner only.');

    let text = ctx.message.text.replace(/^\/broadcast(@\w+)?\s*/i, '').trim();
    if (!text) {
      const r = ctx.message.reply_to_message;
      text = r?.text || r?.caption || '';
    }
    if (!text) return replyHTML(ctx, 'Usage: <code>/broadcast message</code>');

    let progress = null;
    try {
      progress = await replyHTML(ctx, '📣 Preparing broadcast…');
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
            `📣 <b>Broadcast Progress</b>\n━━━━━━━━━━━━━━\nProcessed: <b>${p.processed}</b>/<b>${p.total}</b>\nSent: <b>${p.ok}</b>\nSkipped: <b>${p.skipped}</b>\nFailed: <b>${p.fail}</b>`
          );
        }
      );

      if (progress?.message_id) {
        await editByIds(
          bot,
          ctx.chat.id,
          progress.message_id,
          `✅ <b>Broadcast done</b>\n━━━━━━━━━━━━━━\nSent: <b>${result.ok}</b>\nSkipped: <b>${result.skipped}</b>\nFailed: <b>${result.fail}</b>\nProcessed: <b>${result.processed}</b>/<b>${result.total}</b>${result.cancelled ? '\n🛑 <b>Stopped</b>' : ''}`
        );
      } else {
        await replyHTML(
          ctx,
          `✅ Broadcast done. Sent: <b>${result.ok}</b> · Skipped: <b>${result.skipped}</b> · Failed: <b>${result.fail}</b>`
        );
      }
    } catch (e) {
      if (progress?.message_id) {
        await editByIds(
          bot,
          ctx.chat.id,
          progress.message_id,
          e.message === 'BROADCAST_RUNNING'
            ? '⚠️ Broadcast တစ်ခု run နေပါတယ်။'
            : '⚠️ Broadcast error'
        );
      } else {
        await replyHTML(
          ctx,
          e.message === 'BROADCAST_RUNNING'
            ? '⚠️ Broadcast တစ်ခု run နေပါတယ်။'
            : '⚠️ Broadcast error'
        );
      }
    }
  });

  bot.command('broadcastend', async (ctx) => {
    const t = await ensureTreasury();
    if (!isOwner(ctx, t)) return replyHTML(ctx, '⛔ Owner only.');
    return replyHTML(
      ctx,
      stopBroadcast() ? '🛑 Broadcast stopping…' : 'ℹ️ Broadcast မရှိပါ။'
    );
  });
};
