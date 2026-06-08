'use strict';

const { COIN } = require('../../config/constants');
const {
  transferBalance,
  ensureUser,
  getUser,
} = require('../../services/economyService');
const { replyHTML, editByIds } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { mentionHtml, isGroupChat } = require('../../utils/helpers');
const { checkCooldown } = require('../../services/cooldownService');

const pendingGifts = new Map();

const GIFT_TIMEOUT_MS = Number(process.env.GIFT_CONFIRM_TIMEOUT_MS || 60_000);
const GIFT_MAX_PENDING = Number(process.env.GIFT_MAX_PENDING || 10_000);

function cleanupPendingGifts() {
  const now = Date.now();

  for (const [id, gift] of pendingGifts.entries()) {
    if (gift.expiresAt <= now) {
      if (gift.timeoutHandle) clearTimeout(gift.timeoutHandle);
      pendingGifts.delete(id);
    }
  }

  if (pendingGifts.size > GIFT_MAX_PENDING) {
    const deleteCount = Math.ceil(pendingGifts.size * 0.20);
    let deleted = 0;

    for (const [id, gift] of pendingGifts.entries()) {
      if (gift.timeoutHandle) clearTimeout(gift.timeoutHandle);
      pendingGifts.delete(id);
      deleted += 1;
      if (deleted >= deleteCount) break;
    }
  }
}

function makeGiftId() {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function getAmountFromText(ctx) {
  const parts = String(ctx.message?.text || '').trim().split(/\s+/);
  return Number(parts[1]);
}

function confirmText(ctx, target, amount) {
  return (
    `🎁 <b>Gift Confirm</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ပေးပို့သူ: ${mentionHtml(ctx.from)}\n` +
    `လက်ခံသူ: ${mentionHtml(target)}\n` +
    `Amount: <b>${fmt(amount)}</b> ${COIN}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `✅ Confirm နှိပ်မှ ငွေလွှဲပါမယ်။\n` +
    `❌ Cancel နှိပ်ရင် ပယ်ဖျက်ပါမယ်။`
  );
}

function successText(gift) {
  return (
    `🎁 <b>Gift Success</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ပေးပို့သူ: ${mentionHtml(gift.from)}\n` +
    `လက်ခံသူ: ${mentionHtml(gift.to)}\n` +
    `Amount: <b>${fmt(gift.amount)}</b> ${COIN}`
  );
}

function cancelledText(gift) {
  return (
    `❌ <b>Gift Cancelled</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ပေးပို့သူ: ${mentionHtml(gift.from)}\n` +
    `လက်ခံသူ: ${mentionHtml(gift.to)}\n` +
    `Amount: <b>${fmt(gift.amount)}</b> ${COIN}`
  );
}

function expiredText(gift) {
  return (
    `⌛ <b>Gift Expired</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ပေးပို့သူ: ${mentionHtml(gift.from)}\n` +
    `လက်ခံသူ: ${mentionHtml(gift.to)}\n` +
    `Amount: <b>${fmt(gift.amount)}</b> ${COIN}`
  );
}

function failedText(gift) {
  return (
    `⚠️ <b>Gift Failed</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `ပေးပို့သူ: ${mentionHtml(gift.from)}\n` +
    `လက်ခံသူ: ${mentionHtml(gift.to)}\n` +
    `Amount: <b>${fmt(gift.amount)}</b> ${COIN}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Balance မလုံလောက်ပါ သို့မဟုတ် transfer error ဖြစ်နေပါတယ်။`
  );
}

function clearGift(id) {
  const gift = pendingGifts.get(id);

  if (gift?.timeoutHandle) clearTimeout(gift.timeoutHandle);

  pendingGifts.delete(id);

  return gift;
}

module.exports = (bot) => {
  async function createGift(ctx, amount) {
    cleanupPendingGifts();

    if (!isGroupChat(ctx)) {
      return replyHTML(
        ctx,
        'ℹ️ group ထဲမှာပဲ သုံးနိုင်ပါတယ်။',
        replyOptions(ctx)
      );
    }

    const target = ctx.message?.reply_to_message?.from;

    if (!target?.id) {
      return replyHTML(
        ctx,
        '⚠️ Reply လုပ်ပြီး <code>.gift 200</code> သို့မဟုတ် <code>/gift 200</code> သုံးပါ။',
        replyOptions(ctx)
      );
    }

    if (target.is_bot) {
      return replyHTML(ctx, '🤖 Bot ကို gift မပို့နိုင်ပါ။', replyOptions(ctx));
    }

    if (target.id === ctx.from.id) {
      return replyHTML(ctx, '😅 ကိုယ့်ကိုကိုယ် gift မပို့နိုင်ပါ။', replyOptions(ctx));
    }

    const giftAmount = Math.floor(Number(amount));

    if (!Number.isFinite(giftAmount) || giftAmount <= 0) {
      return replyHTML(
        ctx,
        '🎁 Usage: Reply user message + <code>.gift 500</code>',
        replyOptions(ctx)
      );
    }

    const cooldownLeft = checkCooldown(`gift:${ctx.from.id}`, 3);

    if (cooldownLeft > 0) {
      return replyHTML(
        ctx,
        `⏳ ခဏစောင့်ပါ… (${cooldownLeft}s)`,
        replyOptions(ctx)
      );
    }

    const sender = await getUser(ctx.from.id);

    if (Number(sender?.balance || 0) < giftAmount) {
      return replyHTML(ctx, '❌ လက်ကျန်ငွေ မလုံလောက်ပါ။', replyOptions(ctx));
    }

    await ensureUser(target);

    const id = makeGiftId();
    const expiresAt = Date.now() + GIFT_TIMEOUT_MS;

    const sent = await replyHTML(ctx, confirmText(ctx, target, giftAmount), {
      ...replyOptions(ctx),
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirm', callback_data: `GIFT:C:${id}` },
            { text: '❌ Cancel', callback_data: `GIFT:X:${id}` },
          ],
        ],
      },
    });

    if (!sent?.message_id) return;

    const gift = {
      id,
      chatId: ctx.chat.id,
      msgId: sent.message_id,
      fromId: ctx.from.id,
      toId: target.id,
      from: ctx.from,
      to: target,
      amount: giftAmount,
      expiresAt,
      timeoutHandle: null,
    };

    gift.timeoutHandle = setTimeout(async () => {
      const expired = pendingGifts.get(id);
      if (!expired) return;

      pendingGifts.delete(id);

      try {
        await editByIds(bot, expired.chatId, expired.msgId, expiredText(expired));
      } catch (_) {}
    }, GIFT_TIMEOUT_MS);

    pendingGifts.set(id, gift);
  }

  bot.hears(/^\.(gift)\s+(\d+)\s*$/i, async (ctx) => {
    return createGift(ctx, Number(ctx.match[2]));
  });

  bot.command('gift', async (ctx) => {
    return createGift(ctx, getAmountFromText(ctx));
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || '');

    if (!data.startsWith('GIFT:')) {
      return next();
    }

    cleanupPendingGifts();

    const [, action, id] = data.split(':');
    const gift = pendingGifts.get(id);

    if (!gift) {
      try {
        await ctx.answerCbQuery('Gift request expired.', { show_alert: true });
      } catch (_) {}

      return;
    }

    if (ctx.from.id !== gift.fromId) {
      try {
        await ctx.answerCbQuery('ပေးပို့သူပဲ Confirm/Cancel လုပ်နိုင်ပါတယ်။', {
          show_alert: true,
        });
      } catch (_) {}

      return;
    }

    if (action === 'X') {
      clearGift(id);

      try {
        await ctx.answerCbQuery('Gift cancelled.');
      } catch (_) {}

      return editByIds(bot, gift.chatId, gift.msgId, cancelledText(gift));
    }

    if (action !== 'C') {
      try {
        await ctx.answerCbQuery('Unknown gift action.', { show_alert: true });
      } catch (_) {}

      return;
    }

    try {
      await ctx.answerCbQuery('Processing gift...');
    } catch (_) {}

    try {
      await transferBalance(gift.fromId, gift.toId, gift.amount, {
        chatId: gift.chatId,
        giftId: id,
      });

      clearGift(id);

      return editByIds(bot, gift.chatId, gift.msgId, successText(gift));
    } catch (err) {
      try {
        await ctx.answerCbQuery(
          'Balance မလုံလောက်ပါ သို့မဟုတ် transfer error ဖြစ်နေပါတယ်။',
          { show_alert: true }
        );
      } catch (_) {}

      return editByIds(bot, gift.chatId, gift.msgId, failedText(gift));
    }
  });
};
