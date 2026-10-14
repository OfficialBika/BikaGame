'use strict';

const { getDb } = require('../config/database');
const { ensureTreasury, isOwner, setRtpWinRate } = require('../services/treasuryService');
const { replyHTML } = require('../utils/telegram');
const { fmt } = require('../utils/format');

const BJ_RTP_SETTING_KEY = 'blackjack_rtp';
const DEFAULT_BJ_RTP = Math.max(0, Math.min(100, Number(process.env.BLACKJACK_DEFAULT_RTP || 50)));

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function parseNumericRate(value) {
  const raw = String(value || '').trim().replace('%', '');
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return Math.floor(n);
}

async function setBjRtp(rate, updatedByUserId) {
  const finalRate = Math.max(0, Math.min(100, Math.floor(Number(rate))));
  const now = new Date();
  await getDb().collection('config').updateOne(
    { key: BJ_RTP_SETTING_KEY },
    {
      $set: {
        key: BJ_RTP_SETTING_KEY,
        winRate: finalRate,
        updatedByUserId: updatedByUserId || null,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );
  return finalRate;
}

module.exports = (bot) => {
  bot.use(async (ctx, next) => {
    const text = String(ctx.message?.text || '').trim();
    if (!text.startsWith('/')) return next();

    const parts = text.split(/\s+/).filter(Boolean);
    const command = String(parts[0] || '').split('@')[0].toLowerCase();

    // These aliases only intercept numeric setter forms. Existing /rtp <game>,
    // /rtp and all Promo RTP behavior continue through the original handlers.
    if (command !== '/rtp' && command !== '/bjrtp') return next();

    const value = parts[1];
    if (value == null) return next();

    const rate = parseNumericRate(value);
    if (rate == null) return next();

    const treasury = await ensureTreasury();
    if (!isOwner(ctx, treasury)) {
      return replyHTML(ctx, '⛔ <b>Owner only.</b>', replyOptions(ctx));
    }

    if (command === '/rtp') {
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

    const finalRate = await setBjRtp(rate, ctx.from?.id);
    return replyHTML(
      ctx,
      `🃏 <b>Blackjack RTP Updated</b>\n` +
        `━━━━━━━━━━━━━━\n` +
        `BJ RTP: <b>${fmt(finalRate)}%</b>\n` +
        `Promo RTP: <b>မပြောင်းပါ</b>`,
      replyOptions(ctx)
    );
  });
};
