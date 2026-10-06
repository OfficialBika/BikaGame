'use strict';

const { ensureTreasury, isOwner } = require('../services/treasuryService');
const { isBotCommandText } = require('../utils/helpers');
const { replyHTML } = require('../utils/telegram');

function bypass(text = '') {
  return /^\/(on|off|broadcastend|setvipwr|vipwr|ping|status)(@\w+)?\b/i.test(String(text).trim());
}

module.exports = async (ctx, next) => {
  const t = await ensureTreasury();
  if (isOwner(ctx, t)) return next();

  const text = String(ctx.message?.text || ctx.callbackQuery?.data || '').trim();

  // Maintenance mode must not answer arbitrary Telegram commands/messages.
  // Only commands actually owned by this bot are blocked with a reply.
  if (!(ctx.updateType === 'callback_query' || isBotCommandText(text))) {
    return next();
  }

  if (bypass(text)) return next();

  if (t?.maintenanceMode) {
    if (ctx.updateType === 'callback_query') {
      try {
        await ctx.answerCbQuery('Bot ပြုပြင်နေပါတယ်။', { show_alert: true });
      } catch (_) {}
      return;
    }

    return replyHTML(
      ctx,
      '🛠️ <b>Bot ပြုပြင်နေပါတယ်</b>\n' +
      '━━━━━━━━━━━━\n' +
      'ခေတ္တစောင့်ဆိုင်းပေးပါ။'
    );
  }

  return next();
};
