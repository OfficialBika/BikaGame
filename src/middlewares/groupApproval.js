'use strict';

const { ensureTreasury, isOwner } = require('../services/treasuryService');
const { getGroup } = require('../services/groupService');
const { isGroupChat, isCommandLikeText } = require('../utils/helpers');
const { replyHTML } = require('../utils/telegram');

const APPROVAL_COMMANDS = new Set([
  '/approve',
  '/reject',
  '/groupstatus',
]);

function normalizeCommand(text) {
  const first = String(text || '').trim().split(/\s+/)[0] || '';
  return first.split('@')[0].toLowerCase();
}

function isApprovalCommand(text) {
  return APPROVAL_COMMANDS.has(normalizeCommand(text));
}

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

module.exports = async (ctx, next) => {
  if (!isGroupChat(ctx)) {
    return next();
  }

  const text = String(ctx.message?.text || ctx.callbackQuery?.data || '').trim();
  const isCallback = ctx.updateType === 'callback_query';
  const isCommand = isCommandLikeText(text);

  if (!(isCallback || isCommand)) {
    return next();
  }

  /*
   * Always allow owner/group approval commands to reach the command handler.
   * This prevents /approve from being blocked before it can reply.
   */
  if (!isCallback && isApprovalCommand(text)) {
    return next();
  }

  const treasury = await ensureTreasury();

  if (isOwner(ctx, treasury)) {
    return next();
  }

  const group = await getGroup(ctx.chat.id);

  if (!group || group.approvalStatus === 'approved') {
    return next();
  }

  if (isCallback) {
    try {
      await ctx.answerCbQuery('Owner approval required', {
        show_alert: true,
      });
    } catch (_) {}

    return;
  }

  const options = replyOptions(ctx);

  if (group.botIsAdmin) {
    return replyHTML(
      ctx,
      `⛔ <b>Owner approval မရသေးပါ</b>\n` +
        `━━━━━━━━━━━━\n` +
        `Owner က ဒီ group ထဲဝင်ပြီး <code>/approve</code> ပေးမှ အသုံးပြုနိုင်ပါမယ်။`,
      options
    );
  }

  return replyHTML(
    ctx,
    `⚠️ <b>Bot ကို Admin ပေးပါ</b>\n` +
      `━━━━━━━━━━━━\n` +
      `Admin ပေးပြီး Owner က <code>/approve</code> ပေးမှ အသုံးပြုနိုင်ပါမယ်။\n` +
      `Status စစ်ရန်: <code>/groupstatus</code>`,
    options
  );
};
