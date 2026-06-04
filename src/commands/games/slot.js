'use strict';

const { COIN, SLOT } = require('../../config/constants');
const {
  getUser,
  userPayToTreasury,
  treasuryPayToUser,
} = require('../../services/economyService');
const { getTreasury } = require('../../services/treasuryService');
const { checkCooldown } = require('../../services/cooldownService');
const engine = require('../../games/slotEngine');
const { replyHTML, editByIds } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { isGroupChat } = require('../../utils/helpers');

const activeSlots = new Set();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomSymbolFromReel(reel) {
  if (!Array.isArray(reel) || reel.length === 0) {
    throw new Error('SLOT_REEL_EMPTY');
  }

  const index = Math.floor(Math.random() * reel.length);
  return reel[index]?.s || reel[0].s;
}

function randomFrame() {
  return engine.SLOT_DATA.reels.map(randomSymbolFromReel);
}

function animationText(reels, note, title = '🎰 BIKA Pro Slot') {
  return (
    `${title}\n` +
    `━━━━━━━━━━━\n` +
    `<pre>${engine.art(reels)}</pre>\n` +
    `━━━━━━━━━━━\n` +
    `${note}`
  );
}

function resultText(reels, bet, payout) {
  const net = payout - bet;
  const isJackpot = reels[0] === '7' && reels[1] === '7' && reels[2] === '7';

  const headline =
    payout > 0
      ? isJackpot
        ? '🏆 JACKPOT 777!'
        : '✅ WIN'
      : '❌ LOSE';

  return (
    `🎰 <b>BIKA Pro Slot</b>\n` +
    `━━━━━━━━━━━\n` +
    `<pre>${engine.art(reels)}</pre>\n` +
    `━━━━━━━━━━━\n` +
    `<b>${headline}</b>\n` +
    `Bet: <b>${fmt(bet)}</b> ${COIN}\n` +
    `Payout: <b>${fmt(payout)}</b> ${COIN}\n` +
    `Net: <b>${fmt(net)}</b> ${COIN}`
  );
}

module.exports = (bot) => {
  bot.hears(/^\.(slot)\s+(\d+)\s*$/i, async (ctx) => {
    if (!isGroupChat(ctx)) {
      return replyHTML(
        ctx,
        'ℹ️ <code>.slot</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။'
      );
    }

    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const commandMessageId = ctx.message?.message_id;
    const bet = Number(ctx.match?.[2]);

    if (!userId || !chatId) return;

    if (!Number.isInteger(bet) || bet <= 0) {
      return replyHTML(ctx, '⚠️ Bet amount မမှန်ပါ။ Example: <code>.slot 1000</code>');
    }

    if (bet < SLOT.minBet || bet > SLOT.maxBet) {
      return replyHTML(
        ctx,
        `🎰 <b>BIKA Pro Slot</b>\n` +
          `━━━━━━━━━━━\n` +
          `Usage: <code>.slot 1000</code>\n` +
          `Min: <b>${fmt(SLOT.minBet)}</b> ${COIN}\n` +
          `Max: <b>${fmt(SLOT.maxBet)}</b> ${COIN}`
      );
    }

    if (activeSlots.has(userId)) {
      return replyHTML(ctx, '⏳ သင့် slot spin တစ်ခု လက်ရှိ run နေပါတယ်။');
    }

    if (activeSlots.size >= Number(SLOT.maxActive || 5)) {
      return replyHTML(
        ctx,
        `⛔ <b>Slot Busy</b>\n` +
          `━━━━━━━━━━━\n` +
          `တစ်ပြိုင်နက်ဆော့နေသူများလို့ ခဏနားပြီး ပြန်ကြိုးစားပါ။`
      );
    }

    const cooldownSeconds = Math.max(1, Math.ceil(Number(SLOT.cooldownMs || 700) / 1000));
    const cooldownLeft = checkCooldown(`slot:${userId}`, cooldownSeconds);

    if (cooldownLeft > 0) {
      return replyHTML(ctx, `⏳ ခဏစောင့်ပါ… (${cooldownLeft}s)`);
    }

    activeSlots.add(userId);

    let betTaken = false;
    let sent = null;

    try {
      const user = await getUser(userId);

      if (!user) {
        return replyHTML(ctx, '⚠️ User data မတွေ့ပါ။ Bot ကို <code>/start</code> အရင်လုပ်ပါ။');
      }

      try {
        await userPayToTreasury(userId, bet, {
          type: 'slot_bet',
          chatId,
        });
        betTaken = true;
      } catch (err) {
        return replyHTML(ctx, '❌ Balance မလုံလောက်ပါ။');
      }

      const treasury = await getTreasury();
      const finalReels = engine.spin(user, treasury?.vipWinRate);
      const multiplier = engine.multiplier(finalReels);

      let payout = multiplier > 0 ? Math.floor(bet * multiplier) : 0;

      if (payout > 0) {
        const latestTreasury = await getTreasury();
        const ownerBalance = Math.max(0, Number(latestTreasury?.ownerBalance || 0));
        const capPercent = Math.max(0, Math.min(1, Number(SLOT.capPercent || 0.30)));
        const maxPayout = Math.floor(ownerBalance * capPercent);

        payout = Math.min(payout, maxPayout, ownerBalance);
      }

      const firstFrame = randomFrame();

      sent = await replyHTML(
        ctx,
        animationText(firstFrame, '🔄 Reels starting...'),
        { reply_to_message_id: commandMessageId }
      );

      if (!sent?.message_id) {
        throw new Error('SLOT_ANIMATION_MESSAGE_FAILED');
      }

      const resultMessageId = sent.message_id;

      // Edit 1: all reels rolling
      await sleep(250);
      await editByIds(
        bot,
        chatId,
        resultMessageId,
        animationText(randomFrame(), '🎲 Rolling...')
      );

      // Edit 2: first reel locked, remaining reels rolling
      await sleep(350);
      await editByIds(
        bot,
        chatId,
        resultMessageId,
        animationText(
          [
            finalReels[0],
            randomSymbolFromReel(engine.SLOT_DATA.reels[1]),
            randomSymbolFromReel(engine.SLOT_DATA.reels[2]),
          ],
          '🔒 First reel locked...'
        )
      );

      if (payout > 0) {
        try {
          await treasuryPayToUser(userId, payout, {
            type: 'slot_win',
            bet,
            payout,
            multiplier,
            combo: finalReels.join(','),
          });
        } catch (err) {
          try {
            await treasuryPayToUser(userId, bet, {
              type: 'slot_refund',
              bet,
              reason: 'payout_failed',
            });
          } catch (_) {}

          betTaken = false;

          // Edit 3: payout error result
          await sleep(450);
          await editByIds(
            bot,
            chatId,
            resultMessageId,
            `🎰 <b>BIKA Pro Slot</b>\n` +
              `━━━━━━━━━━━\n` +
              `<pre>${engine.art(finalReels)}</pre>\n` +
              `━━━━━━━━━━━\n` +
              `⚠️ Payout error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`
          );

          return;
        }
      }

      betTaken = false;

      // Edit 3: final result
      await sleep(450);
      await editByIds(
        bot,
        chatId,
        resultMessageId,
        resultText(finalReels, bet, payout)
      );
    } catch (err) {
      if (betTaken) {
        try {
          await treasuryPayToUser(userId, bet, {
            type: 'slot_refund',
            bet,
            reason: 'slot_runtime_error',
          });
        } catch (_) {}
      }

      if (sent?.message_id) {
        await editByIds(
          bot,
          chatId,
          sent.message_id,
          '⚠️ <b>Slot Error</b>\n━━━━━━━━━━━\nError ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။'
        );
      } else {
        await replyHTML(
          ctx,
          '⚠️ <b>Slot Error</b>\n━━━━━━━━━━━\nError ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။'
        );
      }
    } finally {
      activeSlots.delete(userId);
    }
  });
};
