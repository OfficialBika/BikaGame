'use strict';

/**
 * Telegram real dice engine.
 *
 * IMPORTANT:
 * The caller must use:
 *   const result = await dice.roll(ctx, userA, userB, vipWinRate);
 *
 * The visible Telegram dice values are used exactly as returned.
 * VIP values are accepted for API compatibility but do not alter real dice results.
 */

function isTelegramContext(value) {
  return Boolean(value?.telegram?.sendDice && value?.chat?.id);
}

function getReplyMessageId(ctx) {
  return (
    ctx?.callbackQuery?.message?.message_id ||
    ctx?.message?.message_id ||
    undefined
  );
}

function getRetryAfterSeconds(err) {
  const direct = Number(err?.response?.parameters?.retry_after);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const message = String(err?.message || err || '');
  const match = message.match(/retry after\s+(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTelegramDice(ctx, options = {}) {
  const {
    maxRetries = 3,
    delayBetweenRollsMs = 900,
    replyToMessageId = getReplyMessageId(ctx),
  } = options;

  if (!isTelegramContext(ctx)) {
    throw new TypeError(
      'diceEngine.roll requires a Telegraf ctx as the first argument'
    );
  }

  const sendOptions = replyToMessageId
    ? { reply_to_message_id: replyToMessageId }
    : {};

  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const message = await ctx.telegram.sendDice(ctx.chat.id, sendOptions);
      const value = message?.dice?.value;

      if (!Number.isInteger(value) || value < 1 || value > 6) {
        throw new Error('TELEGRAM_DICE_VALUE_MISSING');
      }

      if (delayBetweenRollsMs > 0) {
        await sleep(delayBetweenRollsMs);
      }

      return value;
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries) break;

      const retryAfter = getRetryAfterSeconds(err);
      const waitMs =
        retryAfter > 0
          ? retryAfter * 1000 + 250
          : 500 * attempt + Math.floor(Math.random() * 250);

      await sleep(waitMs);
    }
  }

  throw lastError || new Error('TELEGRAM_DICE_SEND_FAILED');
}

/**
 * Roll two real Telegram dice.
 *
 * @param {Object} ctx Telegraf context
 * @param {Object} userA Challenger user document
 * @param {Object} userB Target user document
 * @param {number} rate Reserved for compatibility; does not alter real results
 * @param {Object} options Retry and timing options
 * @returns {Promise<{d1:number,d2:number,winner:'A'|'B'|'TIE'}>}
 */
async function roll(ctx, userA, userB, rate = 90, options = {}) {
  void userA;
  void userB;
  void rate;

  if (!isTelegramContext(ctx)) {
    throw new TypeError(
      'Use await dice.roll(ctx, userA, userB, rate). Telegram ctx is required.'
    );
  }

  const d1 = await sendTelegramDice(ctx, options);
  const d2 = await sendTelegramDice(ctx, {
    ...options,
    delayBetweenRollsMs: 0,
  });

  const winner = d1 > d2 ? 'A' : d2 > d1 ? 'B' : 'TIE';

  return { d1, d2, winner };
}

module.exports = {
  roll,
  sendTelegramDice,
};
