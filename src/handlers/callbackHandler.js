'use strict';

const game = require('../services/gameService');
const { withLock } = require('../cache/callbackCache');
const {
  getUser,
  userPayToTreasury,
  treasuryPayToUser,
} = require('../services/economyService');
const { getTreasury } = require('../services/treasuryService');
const { HOUSE_CUT_PERCENT, COIN } = require('../config/constants');
const dice = require('../games/diceEngine');
const shan = require('../games/shanEngine');
const { editHTML } = require('../utils/telegram');
const { fmt } = require('../utils/format');
const { mentionHtml } = require('../utils/helpers');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderPartialCards(cards, visibleCount) {
  return cards
    .map((card, index) => (index < visibleCount ? `${card.rank}${card.suit}` : '🂠'))
    .join('  ');
}

async function refundDiceBet(challenge, challengeId, reason) {
  try {
    await treasuryPayToUser(challenge.challengerId, challenge.bet, {
      type: 'dice_refund',
      challengeId,
      reason,
    });
  } catch (_) {}

  try {
    await treasuryPayToUser(challenge.targetUserId, challenge.bet, {
      type: 'dice_refund',
      challengeId,
      reason,
    });
  } catch (_) {}
}

async function refundShanBet(challenge, challengeId, reason) {
  try {
    await treasuryPayToUser(challenge.challengerId, challenge.bet, {
      type: 'shan_refund',
      challengeId,
      reason,
    });
  } catch (_) {}

  try {
    await treasuryPayToUser(challenge.targetUserId, challenge.bet, {
      type: 'shan_refund',
      challengeId,
      reason,
    });
  } catch (_) {}
}

function shanRevealText(challenge, round, visibleCount, note) {
  return (
    `🃏 <b>Shan Koe Mee</b>\n` +
    `━━━━━━━━━━━━\n` +
    `${mentionHtml(challenge.challenger)}\n` +
    `<code>${renderPartialCards(round.cardsA, visibleCount)}</code>\n\n` +
    `${mentionHtml(challenge.target)}\n` +
    `<code>${renderPartialCards(round.cardsB, visibleCount)}</code>\n` +
    `━━━━━━━━━━━━\n` +
    `${note}`
  );
}

function shanResultText(challenge, round, payout) {
  const result = round.result;

  if (result.winner === 'TIE') {
    return (
      `🃏 <b>Shan Result</b>\n` +
      `━━━━━━━━━━━━\n` +
      `${mentionHtml(challenge.challenger)}: <code>${shan.render(round.cardsA)}</code> (${result.infoA.name})\n` +
      `${mentionHtml(challenge.target)}: <code>${shan.render(round.cardsB)}</code> (${result.infoB.name})\n` +
      `━━━━━━━━━━━━\n` +
      `🤝 <b>TIE</b> — refund ပြန်ပေးပြီးပါပြီ။`
    );
  }

  return (
    `🃏 <b>Shan Result</b>\n` +
    `━━━━━━━━━━━━\n` +
    `${mentionHtml(challenge.challenger)}: <code>${shan.render(round.cardsA)}</code> (${result.infoA.name})\n` +
    `${mentionHtml(challenge.target)}: <code>${shan.render(round.cardsB)}</code> (${result.infoB.name})\n` +
    `━━━━━━━━━━━━\n` +
    `🏆 Winner: ${
      result.winner === 'A'
        ? mentionHtml(challenge.challenger)
        : mentionHtml(challenge.target)
    }\n` +
    `✅ Winner gets: <b>${fmt(payout)}</b> ${COIN}`
  );
}

module.exports = (bot) => {
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';

    if (data.startsWith('BUY:') && bot._bikaHandleBuy) {
      return bot._bikaHandleBuy(ctx, data.split(':')[1]);
    }

    if (data.startsWith('DICE:')) {
      const [, action, ...rest] = data.split(':');
      const id = rest.join(':');
      const challenge = game.getDice(id);

      if (!challenge) {
        return ctx.answerCbQuery('Challenge expired', { show_alert: true });
      }

      if (action === 'CANCEL') {
        if (ctx.from.id !== challenge.challengerId) {
          return ctx.answerCbQuery('Only challenger can cancel', {
            show_alert: true,
          });
        }

        game.delDice(id);
        await ctx.answerCbQuery('Cancelled');

        return editHTML(ctx, '❌ <b>Dice Duel Cancelled</b>');
      }

      if (action === 'ACCEPT') {
        return withLock(`dice:${id}`, async () => {
          if (ctx.from.id !== challenge.targetUserId) {
            return ctx.answerCbQuery(
              'ဒီ duel ကို reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်',
              { show_alert: true }
            );
          }

          await ctx.answerCbQuery('Rolling dice...');

          const challenger = await getUser(challenge.challengerId);
          const target = await getUser(challenge.targetUserId);

          if (
            Number(challenger?.balance || 0) < challenge.bet ||
            Number(target?.balance || 0) < challenge.bet
          ) {
            game.delDice(id);
            return editHTML(
              ctx,
              '⚠️ Balance မလုံလောက်လို့ challenge failed.'
            );
          }

          let betsTaken = false;

          try {
            await userPayToTreasury(challenge.challengerId, challenge.bet, {
              type: 'dice_bet',
              challengeId: id,
            });

            await userPayToTreasury(challenge.targetUserId, challenge.bet, {
              type: 'dice_bet',
              challengeId: id,
            });

            betsTaken = true;

            const treasury = await getTreasury();
            const result = await dice.roll(
              ctx,
              challenger,
              target,
              treasury?.vipWinRate
            );

            const pot = challenge.bet * 2;
            const payout = Math.floor(pot * (1 - HOUSE_CUT_PERCENT));

            if (result.winner === 'TIE') {
              await refundDiceBet(challenge, id, 'tie');
              betsTaken = false;
              game.delDice(id);

              return editHTML(
                ctx,
                `🎲 <b>Dice Result</b>\n` +
                  `${mentionHtml(challenge.challenger)} → <b>${result.d1}</b>\n` +
                  `${mentionHtml(challenge.target)} → <b>${result.d2}</b>\n` +
                  `🤝 TIE — refund ပြန်ပေးပြီးပါပြီ။`
              );
            }

            const winnerId =
              result.winner === 'A'
                ? challenge.challengerId
                : challenge.targetUserId;

            await treasuryPayToUser(winnerId, payout, {
              type: 'dice_win',
              challengeId: id,
              pot,
              payout,
              d1: result.d1,
              d2: result.d2,
            });

            betsTaken = false;
            game.delDice(id);

            return editHTML(
              ctx,
              `🎲 <b>Dice Result</b>\n` +
                `${mentionHtml(challenge.challenger)} → <b>${result.d1}</b>\n` +
                `${mentionHtml(challenge.target)} → <b>${result.d2}</b>\n` +
                `🏆 Winner: ${
                  result.winner === 'A'
                    ? mentionHtml(challenge.challenger)
                    : mentionHtml(challenge.target)
                }\n` +
                `✅ Winner gets: <b>${fmt(payout)}</b> ${COIN}`
            );
          } catch (err) {
            if (betsTaken) {
              await refundDiceBet(challenge, id, 'dice_runtime_error');
            }

            game.delDice(id);

            return editHTML(
              ctx,
              `⚠️ <b>Dice Duel Error</b>\n` +
                `━━━━━━━━━━━━\n` +
                `Dice roll error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`
            );
          }
        });
      }

      return ctx.answerCbQuery('OK');
    }

    if (data.startsWith('SHAN:')) {
      const [, action, ...rest] = data.split(':');
      const id = rest.join(':');
      const challenge = game.getShan(id);

      if (!challenge) {
        return ctx.answerCbQuery('Challenge expired', { show_alert: true });
      }

      if (action === 'CANCEL') {
        if (ctx.from.id !== challenge.challengerId) {
          return ctx.answerCbQuery('Only challenger can cancel', {
            show_alert: true,
          });
        }

        game.delShan(id);
        await ctx.answerCbQuery('Cancelled');

        return editHTML(ctx, '❌ <b>Shan Duel Cancelled</b>');
      }

      if (action === 'ACCEPT') {
        return withLock(`shan:${id}`, async () => {
          if (ctx.from.id !== challenge.targetUserId) {
            return ctx.answerCbQuery(
              'ဒီ duel ကို reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်',
              { show_alert: true }
            );
          }

          await ctx.answerCbQuery('Dealing cards...');

          const challenger = await getUser(challenge.challengerId);
          const target = await getUser(challenge.targetUserId);

          if (
            Number(challenger?.balance || 0) < challenge.bet ||
            Number(target?.balance || 0) < challenge.bet
          ) {
            game.delShan(id);
            return editHTML(
              ctx,
              '⚠️ Balance မလုံလောက်လို့ challenge failed.'
            );
          }

          let betsTaken = false;

          try {
            await userPayToTreasury(challenge.challengerId, challenge.bet, {
              type: 'shan_bet',
              challengeId: id,
            });

            await userPayToTreasury(challenge.targetUserId, challenge.bet, {
              type: 'shan_bet',
              challengeId: id,
            });

            betsTaken = true;

            const round = shan.deal();
            const pot = challenge.bet * 2;
            const payout = Math.floor(pot * (1 - HOUSE_CUT_PERCENT));

            await editHTML(
              ctx,
              shanRevealText(challenge, round, 1, '🂠 First card dealt...')
            );

            await sleep(650);

            await editHTML(
              ctx,
              shanRevealText(challenge, round, 2, '🂠 Second card dealt...')
            );

            await sleep(650);

            await editHTML(
              ctx,
              shanRevealText(challenge, round, 3, '✨ All cards revealed...')
            );

            await sleep(650);

            if (round.result.winner === 'TIE') {
              await refundShanBet(challenge, id, 'tie');
              betsTaken = false;
              game.delShan(id);

              return editHTML(ctx, shanResultText(challenge, round, payout));
            }

            const winnerId =
              round.result.winner === 'A'
                ? challenge.challengerId
                : challenge.targetUserId;

            await treasuryPayToUser(winnerId, payout, {
              type: 'shan_win',
              challengeId: id,
              pot,
              payout,
            });

            betsTaken = false;
            game.delShan(id);

            return editHTML(ctx, shanResultText(challenge, round, payout));
          } catch (err) {
            if (betsTaken) {
              await refundShanBet(challenge, id, 'shan_runtime_error');
            }

            game.delShan(id);

            return editHTML(
              ctx,
              `⚠️ <b>Shan Duel Error</b>\n` +
                `━━━━━━━━━━━━\n` +
                `Game error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`
            );
          }
        });
      }

      return ctx.answerCbQuery('OK');
    }

    return next();
  });
};
