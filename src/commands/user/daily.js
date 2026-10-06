"use strict";

const { env } = require('../../config/env');
const { COIN } = require('../../config/constants');
const userModel = require('../../models/userModel');
const { col, withRequiredTx } = require('../../config/database');
const { logTx } = require('../../services/transactionService');
const { getUser } = require('../../services/economyService');
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
    if (!isGroupChat(ctx)) return replyHTML(ctx, 'ℹ️ <code>/dailyclaim</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။', options);
    const userId = ctx.from?.id;
    if (!userId) return;
    const now = new Date();
    const today = startOfDayYangon(now);
    const amount = randInt(env.DAILY_MIN, env.DAILY_MAX);
    const settlementId = `daily:${userId}:${today.toISOString()}`;

    try {
      const result = await withRequiredTx(async (session) => {
        const opts = { session };
        const tx = col('transactions');
        const markerId = `__settlement:${settlementId}`;
        const existing = await tx.findOne({ _id: markerId }, opts);
        if (existing) return { duplicate:true, amount:Number(existing.amount||amount), balance:Number(existing.balanceAfter||0) };

        const claim = await userModel.collection().findOneAndUpdate(
          { userId, $or:[{lastDailyClaimAt:{$exists:false}},{lastDailyClaimAt:null},{lastDailyClaimAt:{$lt:today}}] },
          { $set:{ lastDailyClaimAt:now, updatedAt:now } },
          { session, returnDocument:'before' }
        );
        const previous = unwrapFindOneAndUpdate(claim);
        if (!previous) throw new Error('DAILY_ALREADY_CLAIMED');

        const treasury = await col('treasury').findOneAndUpdate(
          { key:'treasury', ownerBalance:{$gte:amount} },
          { $inc:{ ownerBalance:-amount }, $set:{ updatedAt:now } },
          { session, returnDocument:'after' }
        );
        const bank = unwrapFindOneAndUpdate(treasury);
        if (!bank) throw new Error('TREASURY_INSUFFICIENT');

        const credited = await userModel.collection().findOneAndUpdate(
          { _id:previous._id },
          { $inc:{ balance:amount }, $set:{ updatedAt:now } },
          { session, returnDocument:'after' }
        );
        const userAfter = unwrapFindOneAndUpdate(credited);
        if (!userAfter) throw new Error('USER_CREDIT_FAILED');

        await logTx({ type:'daily_claim', fromUserId:'TREASURY', toUserId:userAfter.userId, amount, meta:{ idempotencyKey:markerId, claimDate:today.toISOString() }, balanceAfter:Number(userAfter.balance||0) }, opts);
        await tx.insertOne({ _id:markerId, type:'daily_claim_settlement', userId:userAfter.userId, amount, balanceAfter:Number(userAfter.balance||0), createdAt:now }, opts);
        return { duplicate:false, amount, balance:Number(userAfter.balance||0) };
      });

      if (result.duplicate) return replyHTML(ctx, dailySuccessText(ctx, result.amount, result.balance, now), options);
      return replyHTML(ctx, dailySuccessText(ctx, result.amount, result.balance, now), options);
    } catch (err) {
      if (String(err?.message||err) === 'DAILY_ALREADY_CLAIMED') return replyHTML(ctx, '⏳ ဒီနေ့ claim လုပ်ပြီးပြီလေ! တစ်ရက် ဘယ်နှကြိမ်ယူချင်နေတာလဲ လစ်လစ် နောက်နေ့မှ ပြန်လုပ်', options);
      if (String(err?.message||err) === 'TREASURY_INSUFFICIENT') return replyHTML(ctx, '🏦 ဘဏ်ငွေလက်ကျန် မလုံလောက်လို့ daily claim မပေးနိုင်သေးပါ။', options);
      return replyHTML(ctx, '⚠️ Daily claim error ဖြစ်လို့ ပြန်စမ်းကြည့်ပါ။', options);
    }
  }
  bot.command('dailyclaim', dailyClaim);
  bot.command('daily', dailyClaim);
  bot.hears(/^\.(dailyclaim|daily)\s*$/i, dailyClaim);
};
