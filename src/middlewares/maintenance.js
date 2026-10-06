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
  // This also guarantees /on can be sent by the owner to bring the bot back.
  if (isOwner(ctx, t)) {
    return next();
  }

  if (!t?.maintenanceMode) {
    return next();
  }

  // Do not interfere with ordinary non-command chat messages.
  // Every command/callback is blocked during maintenance for non-owners,
  // including commands not present in the bot command registry.
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

  return replyHTML(
    ctx,
    '🛠️ <b>Bot Maintenance Mode</b>
' +
      '━━━━━━━━━━━━
' +
      'လက်ရှိ Bot ကို ပြုပြင်နေပါတယ်။
' +
      'Owner သာ အသုံးပြုနိုင်ပါတယ်။
' +
      'ခဏစောင့်ပြီး ပြန်သုံးပေးပါ။'
  );
};
