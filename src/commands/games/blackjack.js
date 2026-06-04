'use strict';

const { COIN, BLACKJACK } = require('../../config/constants');
const {
  getUser,
  userPayToTreasury,
  treasuryPayToUser,
} = require('../../services/economyService');
const { checkCooldown } = require('../../services/cooldownService');
const bj = require('../../games/blackjackEngine');
const { replyHTML, editByIds } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { isGroupChat } = require('../../utils/helpers');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderPartialCards(cards, visibleCount) {
  return cards
    .map((card, index) => (index < visibleCount ? `${card.rank}${card.suit}` : '🂠'))
    .join('  ');
}

function blackjackRevealText(round, playerVisible, dealerVisible, note) {
  return (
    `🃏 <b>Blackjack</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Player: <b>${renderPartialCards(round.player, playerVisible)}</b>\n` +
    `Dealer: <b>${renderPartialCards(round.dealer, dealerVisible)}</b>\n` +
    `━━━━━━━━━━━━\n` +
    `${note}`
  );
}

function blackjackResultText(round, bet, payout) {
  return (
    `🃏 <b>Blackjack</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Player: <b>${bj.render(round.player)}</b> (${round.pv})\n` +
    `Dealer: <b>${bj.render(round.dealer)}</b> (${round.dv})\n` +
    `━━━━━━━━━━━━\n` +
    `Result: <b>${round.result}</b>\n` +
    `Bet: <b>${fmt(bet)}</b> ${COIN}\n` +
    `Payout: <b>${fmt(payout)}</b> ${COIN}\n` +
    `Net: <b>${fmt(payout - bet)}</b> ${COIN}`
  );
}

module.exports = (bot) => {
  bot.hears(/^\.(blackjack|bj)\s+(\d+)\s*$/i, async (ctx) => {
    if (!isGroupChat(ctx)) {
      return replyHTML(ctx, 'ℹ️ group ထဲမှာပဲ သုံးနိုင်ပါတယ်။');
    }

    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const commandMessageId = ctx.message?.message_id;
    const bet = Number(ctx.match?.[2]);

    if (!userId || !chatId) return;

    if (
      !Number.isInteger(bet) ||
      bet < BLACKJACK.minBet ||
      bet > BLACKJACK.maxBet
    ) {
      return replyHTML(
        ctx,
        `🃏 Usage: <code>.blackjack 500</code>\n` +
          `Min: <b>${fmt(BLACKJACK.minBet)}</b> ${COIN}\n` +
          `Max: <b>${fmt(BLACKJACK.maxBet)}</b> ${COIN}`
      );
    }

    const cooldownSeconds = Math.max(
      1,
      Math.ceil(Number(BLACKJACK.cooldownMs || 1500) / 1000)
    );

    const cooldownLeft = checkCooldown(`bj:${userId}`, cooldownSeconds);

    if (cooldownLeft > 0) {
      return replyHTML(ctx, `⏳ ခဏစောင့်ပါ… (${cooldownLeft}s)`);
    }

    const user = await getUser(userId);

    if (Number(user?.balance || 0) < bet) {
      return replyHTML(ctx, '❌ Balance မလုံလောက်ပါ။');
    }

    let betTaken = false;
    let sent = null;

    try {
      await userPayToTreasury(userId, bet, {
        type: 'blackjack_bet',
        chatId,
      });

      betTaken = true;

      const round = bj.play();

      sent = await replyHTML(
        ctx,
        blackjackRevealText(round, 1, 0, '🂠 Player first card...'),
        { reply_to_message_id: commandMessageId }
      );

      if (!sent?.message_id) {
        throw new Error('BLACKJACK_ANIMATION_MESSAGE_FAILED');
      }

      const messageId = sent.message_id;

      await sleep(600);

      await editByIds(
        bot,
        chatId,
        messageId,
        blackjackRevealText(round, 2, 0, '🂠 Player second card...')
      );

      for (let visible = 1; visible <= round.dealer.length; visible += 1) {
        await sleep(600);

        await editByIds(
          bot,
          chatId,
          messageId,
          blackjackRevealText(
            round,
            round.player.length,
            visible,
            visible === round.dealer.length
              ? '✨ Dealer cards revealed...'
              : '🂠 Dealer draws a card...'
          )
        );
      }

      let payout = 0;

      if (round.result === 'BLACKJACK') {
        payout = Math.floor(bet * 2.5);
      } else if (round.result === 'WIN') {
        payout = bet * 2;
      } else if (round.result === 'PUSH') {
        payout = bet;
      }

      if (payout > 0) {
        await treasuryPayToUser(userId, payout, {
          type: 'blackjack_win',
          bet,
          payout,
          result: round.result,
        });
      }

      betTaken = false;

      await sleep(650);

      return editByIds(
        bot,
        chatId,
        messageId,
        blackjackResultText(round, bet, payout)
      );
    } catch (err) {
      if (betTaken) {
        try {
          await treasuryPayToUser(userId, bet, {
            type: 'blackjack_refund',
            bet,
            reason: 'blackjack_runtime_error',
          });
        } catch (_) {}
      }

      if (sent?.message_id) {
        return editByIds(
          bot,
          chatId,
          sent.message_id,
          `⚠️ <b>Blackjack Error</b>\n` +
            `━━━━━━━━━━━━\n` +
            `Game error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`
        );
      }

      return replyHTML(
        ctx,
        `⚠️ <b>Blackjack Error</b>\n` +
          `━━━━━━━━━━━━\n` +
          `Game error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`
      );
    }
  });
};
