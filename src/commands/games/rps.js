'use strict';

const { COIN, RPS } = require('../../config/constants');
const game = require('../../services/gameService');
const { getUser } = require('../../services/economyService');
const { replyHTML, editByIds } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { localizeForUser } = require('../../services/i18nService');
const { isGroupChat, mentionHtml } = require('../../utils/helpers');

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function challengeText(ctx, target, bet) {
  return (
    `🪨 <b>Rock Paper Scissors Duel</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Challenger: ${mentionHtml(ctx.from)}\n` +
    `Opponent: ${mentionHtml(target)}\n` +
    `Bet: <b>${fmt(bet)}</b> ${COIN} each\n` +
    `Prize: <b>${fmt(bet * 2)}</b> ${COIN}\n` +
    `Time Limit: <b>60s</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Only the challenged player can accept.\n` +
    `Both players choose privately; the moves are revealed together.\n` +
    `No Bal is deducted unless both players have selected.`
  );
}

function expiredText(challenge) {
  return (
    `⌛ <b>RPS Challenge Expired</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Challenger: ${mentionHtml(challenge.challenger)}\n` +
    `Opponent: ${mentionHtml(challenge.target)}\n` +
    `Bet: <b>${fmt(challenge.bet)}</b> ${COIN} each\n` +
    `No Bal was deducted.`
  );
}

module.exports = (bot) => {
  bot.hears(/^\.(rps)\s+(\d+)\s*$/i, async (ctx) => {
    const options = replyOptions(ctx);

    if (!isGroupChat(ctx)) {
      return replyHTML(ctx, 'ℹ️ This command is only available in groups.', options);
    }

    const bet = Number(ctx.match?.[2]);
    if (!Number.isSafeInteger(bet) || bet < RPS.minBet || bet > RPS.maxBet) {
      return replyHTML(
        ctx,
        `🪨 Usage: Reply to a user + <code>.rps 500</code>\n` +
          `Min: <b>${fmt(RPS.minBet)}</b> ${COIN}\n` +
          `Max: <b>${fmt(RPS.maxBet)}</b> ${COIN}`,
        options
      );
    }

    const target = ctx.message?.reply_to_message?.from;
    if (!target?.id || target.is_bot || String(target.id) === String(ctx.from?.id)) {
      return replyHTML(ctx, '⚠️ Reply to another real user to challenge them.', options);
    }

    if (!game.canOpenRps()) {
      return replyHTML(ctx, '⛔ Too many RPS duels are active. Please wait.', options);
    }

    const challenger = await getUser(ctx.from.id);
    if (!challenger || Number(challenger.balance || 0) < bet) {
      return replyHTML(ctx, '❌ Insufficient balance.', options);
    }

    const sent = await replyHTML(ctx, challengeText(ctx, target, bet), options);
    if (!sent?.message_id) return;

    const id = game.makeId(ctx.chat.id, sent.message_id);
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
      moves: { A: null, B: null },
      createdAt: Date.now(),
      expiresAt: Date.now() + RPS.timeoutMs,
      timeoutHandle: null,
    };

    game.setRps(id, challenge);

    challenge.timeoutHandle = setTimeout(async () => {
      const active = game.getRps(id);
      if (!active || active.status !== 'OPEN') return;

      game.delRps(id);
      try {
        await editByIds(bot, active.chatId, active.msgId, expiredText(active), { reply_markup: { inline_keyboard: [] } }, active.challengerId);
      } catch (_) {}
    }, Math.max(0, challenge.expiresAt - Date.now()));
    challenge.timeoutHandle.unref?.();

    try {
      await ctx.telegram.editMessageReplyMarkup(ctx.chat.id, sent.message_id, undefined, {
        inline_keyboard: [
          [{
            text: await localizeForUser(ctx.from.id, '✅ Accept RPS Duel'),
            callback_data: `RPS:ACCEPT:${id}`,
            style: 'success',
          }],
          [{
            text: await localizeForUser(ctx.from.id, '❌ Cancel'),
            callback_data: `RPS:CANCEL:${id}`,
            style: 'danger',
          }],
        ],
      });
    } catch (err) {
      game.delRps(id);
      await editByIds(
        bot,
        challenge.chatId,
        challenge.msgId,
        '⚠️ RPS challenge could not be opened. Please try again.',
        {},
        challenge.challengerId
      );
      return;
    }
 
  });
};
