'use strict';

const { env } = require('../../config/env');
const { COIN } = require('../../config/constants');
const userModel = require('../../models/userModel');
const { getUser, treasuryPayToUser } = require('../../services/economyService');
const { getTreasury } = require('../../services/treasuryService');
const { replyHTML } = require('../../utils/telegram');
const { fmt, formatYangon } = require('../../utils/format');
const {
  mentionHtml,
  isGroupChat,
  randInt,
  startOfDayYangon,
} = require('../../utils/helpers');

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;

  return messageId
    ? { reply_to_message_id: messageId }
    : {};
}

function dailySuccessText(ctx, amount, newBalance, now) {
  return (
    `🎁 <b>Daily Claim Success</b>\n` +
    `━━━━━━━━━━━━━━\n` +
    `👤 ${mentionHtml(ctx.from)}\n` +
    `➕ Reward: <b>${fmt(amount)}</b> ${COIN}\n` +
    `💼 Balance: <b>${fmt(newBalance)}</b> ${COIN}\n` +
    `🕒 ${formatYangon(now)} (Yangon Time)`
  );
}

module.exports = (bot) => {
  async function dailyClaim(ctx) {
    const options = replyOptions(ctx);

    if (!isGroupChat(ctx)) {
      return replyHTML(
        ctx,
        'ℹ️ <code>/dailyclaim</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။',
        options
      );
    }

    const userId = ctx.from?.id;

    if (!userId) return;

    const now = new Date();
    const today = startOfDayYangon(now);

    const user = await getUser(userId);
    const lastClaim = user?.lastDailyClaimAt
      ? new Date(user.lastDailyClaimAt)
      : null;

    if (lastClaim && lastClaim >= today) {
      return replyHTML(
        ctx,
        '⏳ ဒီနေ့ claim လုပ်ပြီးပါပြီ။ နောက်နေ့မှ ပြန် claim လုပ်ပါ။',
        options
      );
    }

    const amount = randInt(env.DAILY_MIN, env.DAILY_MAX);
    const treasury = await getTreasury();

    if (Number(treasury?.ownerBalance || 0) < amount) {
      return replyHTML(
        ctx,
        '🏦 ဘဏ်ငွေလက်ကျန် မလုံလောက်လို့ daily claim မပေးနိုင်သေးပါ။',
        options
      );
    }

    /*
     * Atomic claim guard:
     * This prevents double-claim when user taps/sends command repeatedly.
     */
    const claimUpdate = await userModel.collection().findOneAndUpdate(
      {
        userId,
        $or: [
          { lastDailyClaimAt: { $exists: false } },
          { lastDailyClaimAt: null },
          { lastDailyClaimAt: { $lt: today } },
        ],
      },
      {
        $set: {
          lastDailyClaimAt: now,
          updatedAt: now,
        },
      },
      {
        returnDocument: 'before',
      }
    );

    const previousUser = claimUpdate?.value !== undefined
      ? claimUpdate.value
      : claimUpdate;

    if (!previousUser) {
      return replyHTML(
        ctx,
        '⏳ ဒီနေ့ claim လုပ်ပြီးပါပြီ။ နောက်နေ့မှ ပြန် claim လုပ်ပါ။',
        options
      );
    }

    try {
      await treasuryPayToUser(userId, amount, {
        type: 'daily_claim',
      });

      const newBalance = Number(previousUser?.balance || 0) + amount;

      return replyHTML(
        ctx,
        dailySuccessText(ctx, amount, newBalance, now),
        options
      );
    } catch (err) {
      /*
       * If treasury payment fails after daily flag was set,
       * rollback the flag so user can claim again later.
       */
      await userModel.collection().updateOne(
        { userId },
        {
          $set: {
            lastDailyClaimAt: previousUser?.lastDailyClaimAt || null,
            updatedAt: new Date(),
          },
        }
      );

      return replyHTML(
        ctx,
        '⚠️ Daily claim error ဖြစ်လို့ ပြန်စမ်းကြည့်ပါ။',
        options
      );
    }
  }

  bot.command('dailyclaim', dailyClaim);
  bot.command('daily', dailyClaim);
  bot.hears(/^\.(dailyclaim|daily)\s*$/i, dailyClaim);
};
