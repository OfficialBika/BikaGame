'use strict';

const { COIN, SLOT } = require('../../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('../../services/economyService');
const { getTreasury } = require('../../services/treasuryService');
const { checkCooldown } = require('../../services/cooldownService');
const engine = require('../../games/slotEngine');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { isGroupChat } = require('../../utils/helpers');

module.exports = (bot) => {
  bot.hears(/^\.(slot)\s+(\d+)\s*$/i, async (ctx) => {
    if (!isGroupChat(ctx)) return replyHTML(ctx, 'ℹ️ <code>.slot</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။');

    const bet = Number(ctx.match[2]);

    if (bet < SLOT.minBet || bet > SLOT.maxBet) {
      return replyHTML(ctx, `🎰 Usage: <code>.slot 1000</code>\nMin: <b>${fmt(SLOT.minBet)}</b> ${COIN}\nMax: <b>${fmt(SLOT.maxBet)}</b> ${COIN}`);
    }

    const cd = checkCooldown(`slot:${ctx.from.id}`, Math.ceil(SLOT.cooldownMs / 1000));
    if (cd > 0) return replyHTML(ctx, `⏳ ခဏစောင့်ပါ… (${cd}s)`);

    const user = await getUser(ctx.from.id);

    try {
      await userPayToTreasury(ctx.from.id, bet, { type: 'slot_bet', chatId: ctx.chat.id });
    } catch (e) {
      return replyHTML(ctx, '❌ Balance မလုံလောက်ပါ။');
    }

    const treasury = await getTreasury();
    const rtpWinRate = Number.isFinite(Number(treasury?.rtpWinRate)) ? Math.max(0, Math.min(100, Number(treasury.rtpWinRate))) : 35;
    const reels = engine.spin(user, treasury?.vipWinRate, Math.random, rtpWinRate);
    const mult = engine.multiplier(reels);

    let payout = mult > 0 ? Math.floor(bet * mult) : 0;

    if (payout > 0) {
      const latest = await getTreasury();
      const ownerBalance = Math.max(0, Number(latest?.ownerBalance || 0));
      const capPercent = Math.max(0, Math.min(1, Number(SLOT.capPercent || 0.30)));
      payout = Math.min(payout, Math.floor(ownerBalance * capPercent), ownerBalance);
      await treasuryPayToUser(ctx.from.id, payout, { type: 'slot_win', bet, payout, combo: reels.join(','), rtpWinRate });
    }

    return replyHTML(ctx, `🎰 <b>BIKA Pro Slot</b>\n━━━━━━━━━━━\n<pre>${engine.art(reels)}</pre>\n━━━━━━━━━━━\n<b>${payout > 0 ? '✅ WIN' : '❌ LOSE'}</b>\nBet: <b>${fmt(bet)}</b> ${COIN}\nPayout: <b>${fmt(payout)}</b> ${COIN}\nNet: <b>${fmt(payout - bet)}</b> ${COIN}\nRTP WR: <b>${rtpWinRate}%</b>`);
  });
};
