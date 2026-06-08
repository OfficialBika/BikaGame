"use strict";

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
    `🕒 ${formatYangon(now)}`
  );
}

function unwrapFindOneAndUpdate(result) {
  // mongodb driver v4/v5: { value: doc }, newer driver/model wrappers: doc directly
  if (result && Object.prototype.hasOwnProperty.call(result, 'value')) {
    return result.value;
  }
  return result || null;
}

async function ensureDailyUserDocument(userId, now) {
  /*
   * New users sometimes did not have a document yet. The old atomic guard used
   * findOneAndUpdate without upsert, so no document matched and the bot replied
   * as if the user had already claimed. Create only the base user row first,
   * without setting lastDailyClaimAt.
   */
  const existing = await getUser(userId);

  await userModel.collection().updateOne(
    { userId },
    {
      $setOnInsert: {
        userId,
        balance: Number(existing?.balance || 0),
        createdAt: now,
      },
      $set: {
        updatedAt: now,
      },
    },
    { upsert: true }
  );
}

async function rollbackDailyFlag(userId, previousUser) {
  const update = {
    $set: {
      updatedAt: new Date(),
    },
  };

  if (previousUser?.lastDailyClaimAt) {
    update.$set.lastDailyClaimAt = previousUser.lastDailyClaimAt;
  } else {
    update.$unset = { lastDailyClaimAt: '' };
  }

  await userModel.collection().updateOne({ userId }, update);
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

    const amount = randInt(env.DAILY_MIN, env.DAILY_MAX);
    const treasury = await getTreasury();

    if (Number(treasury?.ownerBalance || 0) < amount) {
      return replyHTML(
        ctx,
        '🏦 ဘဏ်ငွေလက်ကျန် မလုံလောက်လို့ daily claim မပေးနိုင်သေးပါ။',
        options
      );
    }

    await ensureDailyUserDocument(userId, now);

    /*
     * Atomic claim guard:
     * - New users now have a document before this query runs.
     * - Only the user whose lastDailyClaimAt is missing/null/before Yangon today can claim.
     * - Repeated commands at the same time still allow only one claim.
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

    const previousUser = unwrapFindOneAndUpdate(claimUpdate);

    if (!previousUser) {
      return replyHTML(
        ctx,
        '⏳ ဒီနေ့ claim လုပ်ပြီးပြီလေ! တစ်ရက် ဘယ်နှကြိမ်ယူချင်နေတာလဲ လစ်လစ် နောက်နေ့မှ ပြန်လုပ်',
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
      await rollbackDailyFlag(userId, previousUser);

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
