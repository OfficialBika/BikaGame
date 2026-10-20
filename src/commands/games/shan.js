'use strict';

const { COIN, SHAN } = require('../../config/constants');
const game = require('../../services/gameService');
const { getUser } = require('../../services/economyService');
const { replyHTML, editByIds } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { localizeForUser } = require('../../services/i18nService');
const { isGroupChat, mentionHtml } = require('../../utils/helpers');

const SHAN_CHALLENGE_TIMEOUT_MS = 60_000;

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function challengeText(ctx, target, bet) {
  return (
    `🃏 <b>Shan Koe Mee Challenge</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Challenger: ${mentionHtml(ctx.from)}\n` +
    `Target: ${mentionHtml(target)}\n` +
    `Bet: <b>${fmt(bet)}</b> ${COIN}\n` +
    `Time Limit: <b>60s</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Target must accept within 60 seconds.`
  );
}

function expiredText(challenge) {
  return (
    `⌛ <b>Shan Challenge Time Expired</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Challenger: ${mentionHtml(challenge.challenger)}\n` +
    `Target: ${mentionHtml(challenge.target)}\n` +
    `Bet: <b>${fmt(challenge.bet)}</b> ${COIN}\n` +
    `━━━━━━━━━━━━\n` +
    `No accept within 60 seconds.`
  );
}

module.exports = (bot) => {
  bot.hears(/^\.(shan)\s+(\d+)\s*$/i, async (ctx) => {
    const options = replyOptions(ctx);

    if (!isGroupChat(ctx)) {
      return replyHTML(ctx, 'ℹ️ This command is only available in groups.', options);
    }

    const bet = Number(ctx.match?.[2]);
    const target = ctx.message?.reply_to_message?.from;

    if (!Number.isInteger(bet) || bet < SHAN.minBet || bet > SHAN.maxBet) {
      return replyHTML(
        ctx,
        `🃏 Usage: Reply + <code>.shan 500</code>\n` +
          `Min: <b>${fmt(SHAN.minBet)}</b> ${COIN}\n` +
          `Max: <b>${fmt(SHAN.maxBet)}</b> ${COIN}`,
        options
      );
    }

    if (!target?.id || target.is_bot || target.id === ctx.from.id) {
      return replyHTML(ctx, '⚠️ Reply to a user to challenge them.', options);
    }

    if (!game.canOpenShan()) {
      return replyHTML(ctx, '⛔ Too many Shan challenges are active. Please wait.', options);
    }

    const user = await getUser(ctx.from.id);

    if (Number(user?.balance || 0) < bet) {
      return replyHTML(ctx, '❌ Insufficient balance.', options);
    }

    const sent = await replyHTML(ctx, challengeText(ctx, target, bet), {
      ...options,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: await localizeForUser(ctx.from.id, '✅ Accept Shan Duel'),
              callback_data: 'SHAN:TEMP',
              style: 'success',
            },
          ],
          [
            {
              text: await localizeForUser(ctx.from.id, '❌ Cancel'),
              callback_data: 'SHAN:TEMP_CANCEL',
              style: 'danger',
            },
          ],
        ],
      },
    });

    if (!sent?.message_id) return;

    const id = game.makeId(ctx.chat.id, sent.message_id);
    const expiresAt = Date.now() + SHAN_CHALLENGE_TIMEOUT_MS;

    await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, sent.message_id, undefined, {
      inline_keyboard: [
        [
          {
            text: await localizeForUser(ctx.from.id, '✅ Accept Shan Duel'),
            callback_data: `SHAN:ACCEPT:${id}`,
            style: 'success',
          },
        ],
        [
          {
            text: await localizeForUser(ctx.from.id, '❌ Cancel'),
            callback_data: `SHAN:CANCEL:${id}`,
            style: 'danger',
          },
        ],
      ],
    });

    const challenge = {
      id,
      chatId: ctx.chat.id,
      msgId: sent.message_id,
      bet,
      challengerId: ctx.from.id,
      targetUserId: target.id,
      challenger: ctx.from,
      target,
      status: 'OPEN',
      expiresAt,
      timeoutMs: SHAN_CHALLENGE_TIMEOUT_MS,
      timeoutHandle: null,
    };

    challenge.timeoutHandle = setTimeout(async () => {
      const active = game.getShan(id);

      if (!active || active.status !== 'OPEN') return;

      game.delShan(id);

      try {
        await editByIds(bot, active.chatId, active.msgId, expiredText(active), {}, active.challengerId);
      } catch (_) {}
    }, SHAN_CHALLENGE_TIMEOUT_MS);

    game.setShan(id, challenge);
  });
};
