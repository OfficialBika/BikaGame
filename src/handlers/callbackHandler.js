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


function clampVipWinRate(value, fallback = 90) {
  const n = Number(String(value ?? '').replace('%', '').trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function isFutureDateLike(value) {
  if (!value) return false;

  const time = value instanceof Date
    ? value.getTime()
    : new Date(value).getTime();

  return Number.isFinite(time) && time > Date.now();
}

function isVipUser(user) {
  if (!user || typeof user !== 'object') return false;

  const directFlags = [
    user.isVip,
    user.vip,
    user.vipActive,
    user.vipEnabled,
    user.vipMember,
  ];

  for (const value of directFlags) {
    if (value === true) return true;
    if (typeof value === 'number' && value > 0) return true;
    if (typeof value === 'string' && ['true', 'yes', 'active', 'vip', 'on'].includes(value.toLowerCase())) {
      return true;
    }
  }

  const dateFields = [
    user.vipUntil,
    user.vipExpiresAt,
    user.vipExpireAt,
    user.vipExpiredAt,
    user.vipEndAt,
    user.vipEnd,
    user.vipExpiry,
  ];

  return dateFields.some(isFutureDateLike);
}

function annotateShanRound(round, meta = {}) {
  return {
    ...round,
    vipMeta: {
      vipApplied: !!meta.vipApplied,
      vipSide: meta.vipSide || null,
      vipWinRate: clampVipWinRate(meta.vipWinRate),
      fairWinner: meta.fairWinner || round?.result?.winner || null,
    },
  };
}

function swapShanHands(round) {
  const swapped = {
    cardsA: round.cardsB,
    cardsB: round.cardsA,
  };

  swapped.result = shan.compare(swapped.cardsA, swapped.cardsB);
  return swapped;
}

function dealShanWithVip(challenger, target, vipWinRate) {
  const rate = clampVipWinRate(vipWinRate);
  const challengerVip = isVipUser(challenger);
  const targetVip = isVipUser(target);
  const firstRound = shan.deal();

  // VIP RTP applies only when exactly one side has VIP.
  if (challengerVip === targetVip || Math.random() * 100 >= rate) {
    return annotateShanRound(firstRound, {
      vipApplied: false,
      vipWinRate: rate,
      fairWinner: firstRound.result?.winner,
    });
  }

  const vipSide = challengerVip ? 'A' : 'B';

  if (firstRound.result?.winner === vipSide) {
    return annotateShanRound(firstRound, {
      vipApplied: true,
      vipSide,
      vipWinRate: rate,
      fairWinner: firstRound.result?.winner,
    });
  }

  // Try fair re-deals first so the output remains natural.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const round = shan.deal();

    if (round.result?.winner === vipSide) {
      return annotateShanRound(round, {
        vipApplied: true,
        vipSide,
        vipWinRate: rate,
        fairWinner: firstRound.result?.winner,
      });
    }
  }

  // Fallback: if the opposite side won, swap hands so the VIP side wins.
  if (firstRound.result?.winner && firstRound.result.winner !== 'TIE') {
    const swapped = swapShanHands(firstRound);

    if (swapped.result?.winner === vipSide) {
      return annotateShanRound(swapped, {
        vipApplied: true,
        vipSide,
        vipWinRate: rate,
        fairWinner: firstRound.result?.winner,
      });
    }
  }

  return annotateShanRound(firstRound, {
    vipApplied: false,
    vipWinRate: rate,
    fairWinner: firstRound.result?.winner,
  });
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
      // BUY:R:divine -> R:divine
      // BUY:HOME -> HOME
      return bot._bikaHandleBuy(ctx, data.slice(4));
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

            const treasury = await getTreasury();
            const round = dealShanWithVip(challenger, target, treasury?.vipWinRate);
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
              vipWinRate: round.vipMeta?.vipWinRate,
              vipApplied: !!round.vipMeta?.vipApplied,
              vipSide: round.vipMeta?.vipSide || null,
              fairWinner: round.vipMeta?.fairWinner || null,
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
