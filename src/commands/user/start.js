const { env } = require('../../config/env');
const { COIN } = require('../../config/constants');
const { ensureTreasury, getTreasury } = require('../../services/treasuryService');
const { ensureUser, markStarted, getUser } = require('../../services/economyService');
const { col, withRequiredTx } = require('../../config/database');
const { logTx } = require('../../services/transactionService');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { mentionHtml } = require('../../utils/helpers');

module.exports = (bot) => bot.start(async (ctx) => {
  await ensureTreasury();
  const u = await ensureUser(ctx.from);
  await markStarted(ctx.from.id);

  if (!u?.startBonusClaimed) {
    try {
      const result = await withRequiredTx(async (session) => {
        const opts = { session };
        const tx = col('transactions');
        const markerId = '__settlement:start_bonus:' + String(ctx.from.id);
        const existing = await tx.findOne({ _id: markerId }, opts);
        if (existing) return { duplicate: true, balance: Number(existing.balanceAfter || 0) };
        const user0 = await col('users').findOneAndUpdate(
          { userId: { $in: [String(ctx.from.id), Number(ctx.from.id)] }, startBonusClaimed: { $ne: true } },
          { $inc: { balance: env.START_BONUS }, $set: { startBonusClaimed: true, updatedAt: new Date() } },
          { session, returnDocument: 'after' }
        );
        const user = user0?.value !== undefined ? user0.value : user0;
        if (!user) throw new Error('START_BONUS_ALREADY_CLAIMED');
        const bank0 = await col('treasury').findOneAndUpdate(
          { key: 'treasury', ownerBalance: { $gte: env.START_BONUS } },
          { $inc: { ownerBalance: -env.START_BONUS }, $set: { updatedAt: new Date() } },
          { session, returnDocument: 'after' }
        );
        const bank = bank0?.value !== undefined ? bank0.value : bank0;
        if (!bank) throw new Error('TREASURY_INSUFFICIENT');
        await logTx({ type: 'start_bonus', fromUserId: 'TREASURY', toUserId: user.userId, amount: env.START_BONUS, meta: { idempotencyKey: markerId } }, opts);
        await tx.insertOne({ _id: markerId, type: 'start_bonus_settlement', userId: user.userId, amount: env.START_BONUS, balanceAfter: Number(user.balance || 0), createdAt: new Date() }, opts);
        return { duplicate: false, balance: Number(user.balance || 0) };
      });
      const user = await getUser(ctx.from.id);
      return replyHTML(ctx, '🎉 <b>Welcome Bonus</b>\n━━━━━━━━━━━━━━━\n👤 ' + mentionHtml(ctx.from) + '\n➕ Bonus: <b>' + fmt(env.START_BONUS) + '</b> ' + COIN + '\n💼 Balance: <b>' + fmt(user?.balance ?? result.balance) + '</b> ' + COIN + '\n━━━━━━━━━━━━━━\nCommands: <code>/dailyclaim</code>, <code>.slot 100</code>, <code>.dice 200</code>, <code>.shan 500</code>, <code>.mybalance</code>, <code>.top10</code>, <code>/shop</code>');
    } catch (_) {}
  }

  return replyHTML(ctx, '👋 <b>Welcome to BIKA Bot</b>\n━━━━━━━━━━━━━━━\nCommands: <code>/dailyclaim</code>, <code>.slot 100</code>, <code>.dice 200</code>, <code>.shan 500</code>, <code>.blackjack 500</code>, <code>.mybalance</code>, <code>.top10</code>, <code>/shop</code>');
});
