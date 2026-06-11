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

let getActivePromoRtp = null;
try {
  ({ getActivePromoRtp } = require('../../services/promoRtpService'));
} catch (_) {
  // Promo RTP service မတင်ထားသေးရင် slot က Global RTP နဲ့ပဲ ဆက်အလုပ်လုပ်ပါမယ်။
  getActivePromoRtp = null;
}

const activeSlots = new Set();
const activeSlotGroups = new Map();

const SLOT_EMOJI = '<tg-emoji emoji-id="5384509325429463744">🎰</tg-emoji>';
const START_ROLLING_EMOJI = '<tg-emoji emoji-id="5926964914684957537">🔄</tg-emoji>';
const SLOT_MAX_ACTIVE_PER_GROUP = Number(process.env.SLOT_MAX_ACTIVE_PER_GROUP || 5);

function getGroupActiveCount(chatId) {
  return activeSlotGroups.get(String(chatId)) || 0;
}

function incGroupActive(chatId) {
  const key = String(chatId);
  activeSlotGroups.set(key, getGroupActiveCount(chatId) + 1);
}

function decGroupActive(chatId) {
  const key = String(chatId);
  const next = Math.max(0, getGroupActiveCount(chatId) - 1);

  if (next <= 0) activeSlotGroups.delete(key);
  else activeSlotGroups.set(key, next);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function randomSymbolFromReel(reel) {
  const index = Math.floor(Math.random() * reel.length);
  return reel[index]?.s || reel[0].s;
}

function randomFrame() {
  return engine.SLOT_DATA.reels.map(randomSymbolFromReel);
}

function animationText(reels, note) {
  return (
    `${SLOT_EMOJI} <b>BIKA Pro Slot</b>\n` +
    `━━━━━━━━━━━\n` +
    `<pre>${engine.art(reels)}</pre>\n` +
    `━━━━━━━━━━━\n` +
    `${note}`
  );
}

function clampRtp(value, fallback = 35) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return Math.max(0, Math.min(100, Number(fallback) || 35));
  }

  return Math.max(0, Math.min(100, numeric));
}

async function resolveSlotRtp(chatId, treasury) {
  const globalRtpWinRate = clampRtp(treasury?.rtpWinRate, 35);

  if (typeof getActivePromoRtp !== 'function') {
    return {
      rtpWinRate: globalRtpWinRate,
      globalRtpWinRate,
      rtpMode: 'global',
      promoRtpId: null,
      promoExpiresAt: null,
    };
  }

  try {
    const promo = await getActivePromoRtp(chatId);

    if (promo) {
      return {
        rtpWinRate: clampRtp(promo.rtp, globalRtpWinRate),
        globalRtpWinRate,
        rtpMode: 'promo',
        promoRtpId: promo._id?.toString?.() || String(promo._id || ''),
        promoExpiresAt: promo.expiresAt || null,
      };
    }
  } catch (_) {
    // Promo DB/service error ကြောင့် slot မရပ်စေဘဲ Global /setrtp RTP ကို fallback သုံးပါမယ်။
  }

  return {
    rtpWinRate: globalRtpWinRate,
    globalRtpWinRate,
    rtpMode: 'global',
    promoRtpId: null,
    promoExpiresAt: null,
  };
}

function resultText(reels, bet, payout) {
  const net = payout - bet;
  const isJackpot = reels[0] === '7' && reels[1] === '7' && reels[2] === '7';
  const isTwoMatch = payout > 0 && engine.isAnyTwo(reels[0], reels[1], reels[2]);

  const headline =
    payout > 0
      ? isJackpot
        ? '🏆 JACKPOT 777!'
        : isTwoMatch
          ? '✅ TWO MATCH WIN'
          : '✅ WIN'
      : '❌ LOSE';

  return (
    `${SLOT_EMOJI} <b>BIKA Pro Slot</b>\n` +
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
    const options = replyOptions(ctx);

    if (!isGroupChat(ctx)) {
      return replyHTML(
        ctx,
        'ℹ️ <code>.slot</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။',
        options
      );
    }

    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const bet = Number(ctx.match?.[2]);

    if (!userId || !chatId) return;

    if (!Number.isInteger(bet) || bet <= 0) {
      return replyHTML(
        ctx,
        '⚠️ Bet amount မမှန်ပါ။ Example: <code>.slot 1000</code>',
        options
      );
    }

    if (bet < SLOT.minBet || bet > SLOT.maxBet) {
      return replyHTML(
        ctx,
        `${SLOT_EMOJI} <b>BIKA Pro Slot</b>\n` +
          `━━━━━━━━━━━\n` +
          `Usage: <code>.slot 1000</code>\n` +
          `Min: <b>${fmt(SLOT.minBet)}</b> ${COIN}\n` +
          `Max: <b>${fmt(SLOT.maxBet)}</b> ${COIN}`,
        options
      );
    }

    if (activeSlots.has(userId)) {
      return replyHTML(ctx, '⏳ Please wait, your slot spin is currently running.', options);
    }

    if (getGroupActiveCount(chatId) >= SLOT_MAX_ACTIVE_PER_GROUP) {
      return replyHTML(ctx, '⛔ Slot Busy Now! Please wait & try again.', options);
    }

    const cooldownSeconds = Math.max(
      1,
      Math.ceil(Number(SLOT.cooldownMs || 700) / 1000)
    );
    const cooldownLeft = checkCooldown(`slot:${userId}`, cooldownSeconds);

    if (cooldownLeft > 0) {
      return replyHTML(ctx, `⏳ ခဏစောင့်ပါ… (${cooldownLeft}s)`, options);
    }

    activeSlots.add(userId);
    incGroupActive(chatId);

    let betTaken = false;
    let sent = null;

    try {
      // Fast visible response first.
      // Expensive DB operations run after this message already appears.
      sent = await replyHTML(
        ctx,
        animationText(randomFrame(), `${START_ROLLING_EMOJI} Start Rolling...`),
        options
      );

      if (!sent?.message_id) {
        throw new Error('SLOT_ANIMATION_MESSAGE_FAILED');
      }

      // DB work starts here after user already sees slot response.
      const user = await getUser(userId);

      if (!user) {
        return editByIds(
          bot,
          chatId,
          sent.message_id,
          '⚠️ User data မတွေ့ပါ။ Bot ကို <code>/start</code> အရင်လုပ်ပါ။'
        );
      }

      try {
        await userPayToTreasury(userId, bet, {
          type: 'slot_bet',
          chatId,
        });
        betTaken = true;
      } catch (_) {
        return editByIds(bot, chatId, sent.message_id, '❌ Balance မလုံလောက်ပါ။');
      }

      const treasury = await getTreasury();
      const {
        rtpWinRate,
        globalRtpWinRate,
        rtpMode,
        promoRtpId,
        promoExpiresAt,
      } = await resolveSlotRtp(chatId, treasury);

      const finalReels = engine.spin(
        user,
        treasury?.vipWinRate,
        Math.random,
        rtpWinRate
      );

      const multiplier = engine.multiplier(finalReels);
      let payout = multiplier > 0 ? Math.floor(bet * multiplier) : 0;

      if (payout > 0) {
        const latestTreasury = await getTreasury();
        const ownerBalance = Math.max(0, Number(latestTreasury?.ownerBalance || 0));
        const capPercent = Math.max(0, Math.min(1, Number(SLOT.capPercent || 0.30)));
        const maxPayout = Math.floor(ownerBalance * capPercent);

        payout = Math.min(payout, maxPayout, ownerBalance);
      }

      if (payout > 0) {
        try {
          await treasuryPayToUser(userId, payout, {
            type: 'slot_win',
            bet,
            payout,
            multiplier,
            combo: finalReels.join(','),
            rtpWinRate,
            globalRtpWinRate,
            rtpMode,
            promoRtpId,
            promoExpiresAt,
          });
        } catch (_) {
          try {
            await treasuryPayToUser(userId, bet, {
              type: 'slot_refund',
              bet,
              reason: 'payout_failed',
            });
          } catch (_) {}

          betTaken = false;

          // Final error edit, reduced from 260ms.
          await sleep(3000);
          return editByIds(
            bot,
            chatId,
            sent.message_id,
            `${SLOT_EMOJI} <b>BIKA Pro Slot</b>\n` +
              `━━━━━━━━━━━\n` +
              `<pre>${engine.art(finalReels)}</pre>\n` +
              `━━━━━━━━━━━\n` +
              `⚠️ Payout error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`
          );
        }
      }

      betTaken = false;

      // Final result edit, reduced from 260ms.
      await sleep(2000);
      return editByIds(
        bot,
        chatId,
        sent.message_id,
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
        return editByIds(
          bot,
          chatId,
          sent.message_id,
          '⚠️ <b>Slot Error</b>\n━━━━━━━━━━━\nError ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။'
        );
      }

      return replyHTML(
        ctx,
        '⚠️ <b>Slot Error</b>\n━━━━━━━━━━━\nError ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။',
        options
      );
    } finally {
      activeSlots.delete(userId);
      decGroupActive(chatId);
    }
  });
};
