'use strict';

const { ensureTreasury, isOwner } = require('../services/treasuryService');
const { isCommandLikeText } = require('../utils/helpers');
const { replyHTML } = require('../utils/telegram');

function isCommandUpdate(ctx, text) {
  if (ctx.updateType === 'callback_query') return true;
  return isCommandLikeText(text);
}

module.exports = async (ctx, next) => {
  const t = await ensureTreasury();
  const text = String(
    ctx.message?.text ||
    ctx.callbackQuery?.data ||
    ''
  ).trim();

  // Owner is the only account allowed to operate while maintenance is ON.
  if (isOwner(ctx, t)) {
    return next();
  }

  if (!t?.maintenanceMode) {
    return next();
  }

  // Ordinary chat messages continue through the bot normally.
  // Every command/callback is blocked for non-owners during maintenance,
  // including commands not listed in the bot command registry.
  if (!isCommandUpdate(ctx, text)) {
    return next();
  }

  if (ctx.updateType === 'callback_query') {
    try {
      await ctx.answerCbQuery(
        '🛠️ Bot ပြုပြင်နေပါတယ်။ Owner ပဲ အသုံးပြုနိုင်ပါတယ်။',
        { show_alert: true }
      );
    } catch (_) {}
    return;
  }

  const messageId = ctx.message?.message_id;
  const replyOptions = messageId
    ? { reply_to_message_id: messageId }
    : {};

  return replyHTML(
    ctx,
    '🛠️ <b>Bot Maintenance Mode</b>\n' +
      '━━━━━━━━━━━━\n' +
      'လက်ရှိ Bot ကို ပြုပြင်နေပါတယ်။\n' +
      'Owner သာ အသုံးပြုနိုင်ပါတယ်။\n' +
      'ခဏစောင့်ပြီး ပြန်သုံးပေးပါ။',
    replyOptions
  );
};
