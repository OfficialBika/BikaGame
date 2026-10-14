'use strict';

const { COIN, SLOT } = require('../../config/constants');
const {
  getUser,
  settleSingleGame,
} = require('../../services/economyService');
const { getTreasury } = require('../../services/treasuryService');
const { checkCooldown } = require('../../services/cooldownService');
const engine = require('../../games/slotEngine');
const { replyHTML } = require('../../utils/telegram');
const { editSlotByIds: editByIds } = require('../../utils/slotEditQueue');
const { fmt } = require('../../utils/format');

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
const configuredSlotGroupLimit = Number(process.env.SLOT_MAX_ACTIVE_PER_GROUP || SLOT.maxActive || 10);
const SLOT_MAX_ACTIVE_PER_GROUP = Number.isFinite(configuredSlotGroupLimit)
  ? Math.max(1, Math.min(30, Math.floor(configuredSlotGroupLimit)))
  : 10;

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

function initialSlotText() {
  // First message: a distinct, compact set of closed reels.
  return (
    `${SLOT_EMOJI} <b>BIKA Pro Slot</b>\n` +
    `━━━━━━━━━━━\n` +
    `<pre>┌────────────────────┐\n` +
    `│    ▣    ▣    ▣     │\n` +
    `└────────────────────┘</pre>\n` +
    `<b>READY</b>`
  );
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

    // Slot is supported in both private DM and group chats.
    // Keep the original chatId for cooldown/promo/ledger metadata.
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

    const spinId = `slot:${chatId}:${ctx.message?.message_id || Date.now()}`;
    let sent = null;
    let rollingEditPromise = Promise.resolve();

    try {
      // Fast visible response first.
      // Expensive DB operations run after this message already appears.
      sent = await replyHTML(
        ctx,
        initialSlotText(),
        options
      );

      if (!sent?.message_id) {
        throw new Error('SLOT_ANIMATION_MESSAGE_FAILED');
      }

      // Start the one rolling-frame edit immediately. Database work runs in parallel;
      // the result edit waits for this promise so the visible stages never race.
      rollingEditPromise = editByIds(
        bot,
        chatId,
        sent.message_id,
        animationText(randomFrame(), `${START_ROLLING_EMOJI} <b>REELS MOVING...</b>`)
      );

      // DB work starts while the rolling-frame edit is in flight.
      const user = await getUser(userId);

      if (!user) {
        await rollingEditPromise;
        return editByIds(
          bot,
          chatId,
          sent.message_id,
          '⚠️ User data မတွေ့ပါ။ Bot ကို <code>/start</code> အရင်လုပ်ပါ။'
        );
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
        const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
        const capPercent = Math.max(0, Math.min(1, Number(SLOT.capPercent || 0.30)));
        const maxPayout = Math.floor(ownerBalance * capPercent);

        payout = Math.min(payout, maxPayout, ownerBalance);
      }

      // One atomic transaction settles the bet and payout together.
      // Any failure rolls the complete settlement back.
      try {
        await settleSingleGame({
          settlementId: spinId,
          typePrefix: 'slot',
          userId,
          bet,
          payout,
          meta: {
            chatId,
            multiplier,
            combo: finalReels.join(','),
            rtpWinRate,
            globalRtpWinRate,
            rtpMode,
            promoRtpId,
            promoExpiresAt,
          },
        });
      } catch (settlementErr) {
        await rollingEditPromise;
        const message = String(settlementErr?.message || '');

        if (message === 'USER_INSUFFICIENT') {
          return editByIds(bot, chatId, sent.message_id, '❌ Balance မလုံလောက်ပါ။');
        }

        return editByIds(
          bot,
          chatId,
          sent.message_id,
          `${SLOT_EMOJI} <b>BIKA Pro Slot</b>\n` +
            `━━━━━━━━━━━\n` +
            `<pre>${engine.art(finalReels)}</pre>\n` +
            `━━━━━━━━━━━\n` +
            `⚠️ Settlement မအောင်မြင်လို့ ငွေစာရင်းကို atomic rollback လုပ်ထားပါတယ်။`
        );
      }

      // The rolling edit overlaps DB work. Wait only if it has not finished yet,
      // then send the final result as the second and last edit.
      await rollingEditPromise;
      return editByIds(
        bot,
        chatId,
        sent.message_id,
        resultText(finalReels, bet, payout)
      );
    } catch (err) {
      // Settlement uses one Mongo transaction. If it throws before commit,
      // the bet is rolled back automatically, so no manual refund is needed.

      if (sent?.message_id) {
        await rollingEditPromise;
        return editByIds(
          bot,
          chatId,
          sent.message_id,
          '⚠️ <b>Slot Error</b>\n━━━━━━━━━━━\nSettlement မအောင်မြင်ပါ။ ငွေစာရင်းကို atomic rollback လုပ်ထားပါတယ်။'
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
