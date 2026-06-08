'use strict';

const { COIN } = require('../../config/constants');
const { transferBalance, ensureUser, getUser } = require('../../services/economyService');
const { replyHTML, editByIds } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { mentionHtml, isGroupChat } = require('../../utils/helpers');
const { checkCooldown } = require('../../services/cooldownService');

const pendingGifts = new Map();
const GIFT_TIMEOUT_MS = Number(process.env.GIFT_CONFIRM_TIMEOUT_MS || 60000);

function makeGiftId(chatId, msgId, fromId, toId) {
  return `${chatId}:${msgId}:${fromId}:${toId}:${Date.now().toString(36)}`;
}

function replyOptions(ctx) {
  const id = ctx.message?.message_id;
  return id ? { reply_to_message_id: id } : {};
}

function textConfirm(ctx, target, amount) {
  return `🎁 <b>Gift Confirm</b>\n━━━━━━━━━━━━━━━━\nပေးပို့သူ: ${mentionHtml(ctx.from)}\nလက်ခံသူ: ${mentionHtml(target)}\nAmount: <b>${fmt(amount)}</b> ${COIN}\n━━━━━━━━━━━━━━━━\nConfirm နှိပ်မှ ငွေလွှဲပါမယ်။`;
}

function textSuccess(g) {
  return `🎁 <b>Gift Success</b>\n━━━━━━━━━━━━━━━━\nပေးပို့သူ: ${mentionHtml(g.from)}\nလက်ခံသူ: ${mentionHtml(g.to)}\nAmount: <b>${fmt(g.amount)}</b> ${COIN}`;
}

function textCancel(g) {
  return `❌ <b>Gift Cancelled</b>\n━━━━━━━━━━━━━━━━\nပေးပို့သူ: ${mentionHtml(g.from)}\nလက်ခံသူ: ${mentionHtml(g.to)}\nAmount: <b>${fmt(g.amount)}</b> ${COIN}`;
}

module.exports = (bot) => {
  async function createGift(ctx, amount) {
    if (!isGroupChat(ctx)) return replyHTML(ctx, 'ℹ️ group ထဲမှာပဲ သုံးနိုင်ပါတယ်။', replyOptions(ctx));

    const target = ctx.message?.reply_to_message?.from;
    if (!target?.id) return replyHTML(ctx, '⚠️ Reply လုပ်ပြီး <code>.gift 200</code> သုံးပါ။', replyOptions(ctx));
    if (target.is_bot) return replyHTML(ctx, '🤖 Bot ကို gift မပို့နိုင်ပါ။', replyOptions(ctx));
    if (target.id === ctx.from.id) return replyHTML(ctx, '😅 ကိုယ့်ကိုကိုယ် gift မပို့နိုင်ပါ။', replyOptions(ctx));

    const giftAmount = Math.floor(Number(amount));
    if (!Number.isFinite(giftAmount) || giftAmount <= 0) return replyHTML(ctx, '🎁 Usage: Reply + <code>.gift 500</code>', replyOptions(ctx));

    const cd = checkCooldown(`gift:${ctx.from.id}`, 3);
    if (cd > 0) return replyHTML(ctx, `⏳ ခဏစောင့်ပါ… (${cd}s)`, replyOptions(ctx));

    const sender = await getUser(ctx.from.id);
    if (Number(sender?.balance || 0) < giftAmount) return replyHTML(ctx, '❌ လက်ကျန်ငွေ မလုံလောက်ပါ။', replyOptions(ctx));

    await ensureUser(target);

    const preview = await replyHTML(ctx, textConfirm(ctx, target, giftAmount), {
      ...replyOptions(ctx),
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirm Gift', callback_data: 'GIFT:TEMP_CONFIRM' },
          { text: '❌ Cancel', callback_data: 'GIFT:TEMP_CANCEL' },
        ]],
      },
    });

    if (!preview?.message_id) return;

    const id = makeGiftId(ctx.chat.id, preview.message_id, ctx.from.id, target.id);
    const timeoutHandle = setTimeout(() => pendingGifts.delete(id), GIFT_TIMEOUT_MS);

    pendingGifts.set(id, {
      id,
      chatId: ctx.chat.id,
      msgId: preview.message_id,
      fromId: ctx.from.id,
      toId: target.id,
      from: ctx.from,
      to: target,
      amount: giftAmount,
      timeoutHandle,
    });

    return ctx.telegram.editMessageReplyMarkup(ctx.chat.id, preview.message_id, undefined, {
      inline_keyboard: [[
        { text: '✅ Confirm Gift', callback_data: `GIFT:CONFIRM:${id}` },
        { text: '❌ Cancel', callback_data: `GIFT:CANCEL:${id}` },
      ]],
    });
  }

  bot.hears(/^\.(gift)\s+(\d+)\s*$/i, async (ctx) => createGift(ctx, Number(ctx.match[2])));

  bot.command('gift', async (ctx) => {
    const amount = Number(String(ctx.message?.text || '').split(/\s+/)[1]);
    return createGift(ctx, amount);
  });

  bot.action(/^GIFT:(CONFIRM|CANCEL):(.+)$/i, async (ctx) => {
    const action = String(ctx.match[1]).toUpperCase();
    const id = ctx.match[2];
    const gift = pendingGifts.get(id);

    if (!gift) return ctx.answerCbQuery('Gift request expired.', { show_alert: true });

    if (ctx.from.id !== gift.fromId) {
      return ctx.answerCbQuery('ပေးပို့သူပဲ confirm/cancel လုပ်နိုင်ပါတယ်။', { show_alert: true });
    }

    if (action === 'CANCEL') {
      if (gift.timeoutHandle) clearTimeout(gift.timeoutHandle);
      pendingGifts.delete(id);
      await ctx.answerCbQuery('Cancelled');
      return editByIds(bot, gift.chatId, gift.msgId, textCancel(gift));
    }

    await ctx.answerCbQuery('Processing gift...');

    try {
      await transferBalance(gift.fromId, gift.toId, gift.amount, { chatId: gift.chatId, giftId: id });
      if (gift.timeoutHandle) clearTimeout(gift.timeoutHandle);
      pendingGifts.delete(id);
      return editByIds(bot, gift.chatId, gift.msgId, textSuccess(gift));
    } catch (e) {
      return ctx.answerCbQuery('Balance မလုံလောက်ပါ သို့မဟုတ် transfer error ဖြစ်နေပါတယ်။', { show_alert: true });
    }
  });
};
