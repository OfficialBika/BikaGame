'use strict';

// Backward-compatible owner RTP control aliases.
// Promo RTP is intentionally not touched here.

const { ensureTreasury, isOwner, setRtpWinRate } = require('../../services/treasuryService');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function parseRate(text) {
  const raw = String(text || '').trim().split(/\s+/)[1];
  if (raw == null) return null;
  const n = Number(String(raw).replace('%', ''));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.floor(n);
}

module.exports = function registerRtpAlias(bot) {
  bot.command('rtp', async (ctx) => {
    const parts = String(ctx.message?.text || '').trim().split(/\s+/).filter(Boolean);

    // /rtp <number> is the explicit legacy/global Slot RTP setter.
    // /rtp <game> continues to be handled by treasury.js for Web RTP lookup.
    if (parts[1] && /^\d+(?:\.\d+)?%?$/.test(parts[1])) {
      const treasury = await ensureTreasury();
      if (!isOwner(ctx, treasury)) {
        return replyHTML(ctx, '⛔ <b>Owner only.</b>', replyOptions(ctx));
      }

      const rate = parseRate(ctx.message?.text);
      if (rate == null) {
        return replyHTML(ctx, 'Usage: <code>/rtp 35</code> or <code>/rtp 35%</code>', replyOptions(ctx));
      }

      const finalRate = await setRtpWinRate(rate);
      return replyHTML(
        ctx,
        `🎰 <b>Slot RTP Updated</b>\n` +
          `━━━━━━━━━━━━━━\n` +
          `Global Slot RTP: <b>${fmt(finalRate)}%</b>\n` +
          `Promo RTP: <b>မပြောင်းပါ</b>`,
        replyOptions(ctx)
      );
    }

    // Let the existing treasury command implementation handle /rtp and /rtp <game>.
    return undefined;
  });
};
