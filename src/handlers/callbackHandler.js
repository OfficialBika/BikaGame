'use strict';

const game = require('../services/gameService');
const { withLock } = require('../cache/callbackCache');
const {
  getUser,
  settleDuel,
} = require('../services/economyService');
const { getTreasury } = require('../services/treasuryService');
const { HOUSE_CUT_PERCENT, COIN } = require('../config/constants');
const dice = require('../games/diceEngine');
const shan = require('../games/shanEngine');
const rps = require('../games/rpsEngine');
const { editHTML, editByIds } = require('../utils/telegram');
const { localizeForUser } = require('../services/i18nService');
const { fmt } = require('../utils/format');
const { mentionHtml } = require('../utils/helpers');

function editChallengeHTML(bot, challenge, html) {
  return editByIds(bot, challenge.chatId, challenge.msgId, html, {}, challenge.challengerId);
}

async function answerLocalized(ctx, text, options) {
  return ctx.answerCbQuery(await localizeForUser(ctx.from?.id, text), options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderPartialCards(cards, visibleCount) {
  return cards
    .map((card, index) => (index < visibleCount ? `${card.rank}${card.suit}` : '🂠'))
    .join('  ');
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


function editRpsChallengeHTML(bot, challenge, html, extra = {}) {
  return editByIds(bot, challenge.chatId, challenge.msgId, html, extra, challenge.challengerId);
}

async function rpsMoveKeyboard(id, localeUserId) {
  const labels = await Promise.all([
    localizeForUser(localeUserId, '🪨 Rock'),
    localizeForUser(localeUserId, '📄 Paper'),
    localizeForUser(localeUserId, '✂️ Scissors'),
  ]);
  return {
    inline_keyboard: [[
      { text: labels[0], callback_data: `RPS:MOVE:${id}:ROCK` },
      { text: labels[1], callback_data: `RPS:MOVE:${id}:PAPER` },
      { text: labels[2], callback_data: `RPS:MOVE:${id}:SCISSORS` },
    ]],
  };
}

function rpsSelectionText(challenge) {
  return (
    `🪨 <b>Rock Paper Scissors</b>\n` +
    `━━━━━━━━━━━━\n` +
    `${mentionHtml(challenge.challenger)} <b>VS</b> ${mentionHtml(challenge.target)}\n` +
    `Bet: <b>${fmt(challenge.bet)}</b> ${COIN} each\n` +
    `Prize: <b>${fmt(challenge.bet * 2)}</b> ${COIN}\n` +
    `━━━━━━━━━━━━\n` +
    `Each player must choose one move.\n` +
    `🔒 Choices stay hidden until both players have selected.\n` +
    `⏳ Time limit: <b>60s</b>`
  );
}

function rpsResultText(challenge, result) {
  const moveA = rps.MOVES[result.moveA];
  const moveB = rps.MOVES[result.moveB];
  const lines =
    `${mentionHtml(challenge.challenger)}: ${moveA.emoji} <b>${moveA.label}</b>\n` +
    `${mentionHtml(challenge.target)}: ${moveB.emoji} <b>${moveB.label}</b>\n` +
    `━━━━━━━━━━━━\n`;

  if (result.winner === 'TIE') {
    return (
      `🤝 <b>RPS RESULT — DRAW</b>\n` +
      `━━━━━━━━━━━━\n` +
      lines +
      `Both selected the same move.\n` +
      `✅ Both players received their full <b>${fmt(challenge.bet)}</b> ${COIN} refund.\n` +
      `No commission was deducted.`
    );
  }

  const winner = result.winner === 'A' ? challenge.challenger : challenge.target;
  return (
    `🏆 <b>ROCK PAPER SCISSORS — WINNER</b>\n` +
    `━━━━━━━━━━━━\n` +
    lines +
    `Winner: ${mentionHtml(winner)}\n` +
    `✅ Full prize: <b>${fmt(challenge.bet * 2)}</b> ${COIN}\n` +
    `No commission was deducted.`
  );
}

async function settleRpsChallenge(bot, challenge) {
  if (!challenge || !challenge.moves?.A || !challenge.moves?.B) return;
  if (!['PLAYING', 'SETTLING'].includes(challenge.status)) return;

  const result = rps.compare(challenge.moves.A, challenge.moves.B);
  const winnerUserId = result.winner === 'A'
    ? challenge.challengerId
    : result.winner === 'B'
      ? challenge.targetUserId
      : null;
  const pot = challenge.bet * 2;

  challenge.status = 'SETTLING';
  if (challenge.timeoutHandle) {
    clearTimeout(challenge.timeoutHandle);
    challenge.timeoutHandle = null;
  }

  try {
    await settleDuel({
      duelId: challenge.id,
      typePrefix: 'rps',
      challengerId: challenge.challengerId,
      targetUserId: challenge.targetUserId,
      winnerUserId,
      bet: challenge.bet,
      payout: winnerUserId ? pot : 0,
      meta: {
        chatId: String(challenge.chatId),
        messageId: challenge.msgId,
        pot,
        moveA: result.moveA,
        moveB: result.moveB,
        commissionPercent: 0,
      },
    });

    game.delRps(challenge.id);
    return editRpsChallengeHTML(bot, challenge, rpsResultText(challenge, result));
  } catch (err) {
    const code = String(err?.message || err);
    if (code === 'CHALLENGER_INSUFFICIENT' || code === 'TARGET_INSUFFICIENT') {
      game.delRps(challenge.id);
      return editRpsChallengeHTML(
        bot,
        challenge,
        '⚠️ <b>RPS Duel Cancelled</b>\n━━━━━━━━━━━━\nA player no longer has enough Bal. The transaction was rolled back, so no Bal was deducted.'
      );
    }

    // Keep the immutable choices and same settlement ID so retrying is safe
    // even when MongoDB reports an uncertain commit acknowledgement.
    challenge.status = 'SETTLING';
    return editRpsChallengeHTML(
      bot,
      challenge,
      '⚠️ <b>RPS Settlement Pending</b>\n━━━━━━━━━━━━\nThe result is locked, but the settlement could not be confirmed. Do not start another duel for this match. Either player can retry safely.',
      {
        reply_markup: {
          inline_keyboard: [[{
            text: '🔄 Retry Settlement',
            callback_data: `RPS:RETRY:${challenge.id}`,
          }]],
        },
      }
    );
  }
}

async function expireRpsChallenge(bot, id) {
  const active = game.getRps(id);
  if (!active || !['OPEN', 'PLAYING'].includes(active.status)) return;

  game.delRps(id);
  const selectedA = Boolean(active.moves?.A);
  const selectedB = Boolean(active.moves?.B);
  const status = active.status === 'OPEN'
    ? 'The challenge was not accepted in time.'
    : `Selection timed out. Player A: ${selectedA ? '✅' : '⌛'} | Player B: ${selectedB ? '✅' : '⌛'}`;

  try {
    await editRpsChallengeHTML(
      bot,
      active,
      `⌛ <b>RPS Duel Expired</b>\n━━━━━━━━━━━━\n${status}\nNo Bal was deducted.`
    );
  } catch (_) {}
}

module.exports = (bot) => {
  bot.on('callback_query', async (ctx, next) => {
    const data = ctx.callbackQuery?.data || '';

    if (data.startsWith('RPS:')) {
      const [, action, ...rest] = data.split(':');
      const moveValue = action === 'MOVE' ? rest.pop() : null;
      const id = rest.join(':');
      const challenge = game.getRps(id);

      if (!challenge) return answerLocalized(ctx, 'Challenge expired', { show_alert: true });

      if (action === 'CANCEL') return withLock(`rps:state:${id}`, async () => {
        if (String(ctx.from.id) !== String(challenge.challengerId)) {
          return answerLocalized(ctx, 'Only the challenger can cancel this duel.', { show_alert: true });
        }
        if (challenge.status !== 'OPEN') {
          return answerLocalized(ctx, 'This duel can no longer be cancelled.', { show_alert: true });
        }
        game.delRps(id);
        await answerLocalized(ctx, 'Cancelled');
        return editRpsChallengeHTML(bot, challenge, '❌ <b>RPS Duel Cancelled</b>\\nNo Bal was deducted.');
      });

      if (action === 'ACCEPT') return withLock(`rps:state:${id}`, async () => {
        if (String(ctx.from.id) !== String(challenge.targetUserId)) {
          return answerLocalized(ctx, 'Only the challenged player can accept this duel.', { show_alert: true });
        }
        if (challenge.status !== 'OPEN') {
          return answerLocalized(ctx, 'This challenge is no longer available.', { show_alert: true });
        }
        if (Date.now() >= challenge.expiresAt) {
          game.delRps(id);
          await answerLocalized(ctx, 'Challenge expired', { show_alert: true });
          return editRpsChallengeHTML(bot, challenge, '⌛ <b>RPS Challenge Expired</b>\\nNo Bal was deducted.');
        }

        await answerLocalized(ctx, 'Challenge accepted. Choose your move.');
        const [challenger, target] = await Promise.all([
          getUser(challenge.challengerId),
          getUser(challenge.targetUserId),
        ]);
        if (!challenger || !target ||
            Number(challenger.balance || 0) < challenge.bet ||
            Number(target.balance || 0) < challenge.bet) {
          game.delRps(id);
          return editRpsChallengeHTML(
            bot,
            challenge,
            '⚠️ <b>RPS Challenge Failed</b>\\nA player does not have enough Bal. No Bal was deducted.'
          );
        }

        challenge.status = 'PLAYING';
        challenge.moves = { A: null, B: null };
        challenge.expiresAt = Date.now() + RPS.timeoutMs;
        if (challenge.timeoutHandle) clearTimeout(challenge.timeoutHandle);
        challenge.timeoutHandle = setTimeout(() => expireRpsChallenge(bot, id), RPS.timeoutMs);
        challenge.timeoutHandle.unref?.();

        return editRpsChallengeHTML(
          bot,
          challenge,
          rpsSelectionText(challenge),
          { reply_markup: await rpsMoveKeyboard(id, challenge.challengerId) }
        );
      });

      if (action === 'MOVE') return withLock(`rps:move:${id}:${ctx.from.id}`, async () => {
        if (game.getRps(id) !== challenge || challenge.status !== 'PLAYING') {
          return answerLocalized(ctx, 'This RPS selection is no longer active.', { show_alert: true });
        }
        if (Date.now() >= challenge.expiresAt) {
          await expireRpsChallenge(bot, id);
          return answerLocalized(ctx, 'Selection time expired', { show_alert: true });
        }

        const side = String(ctx.from.id) === String(challenge.challengerId)
          ? 'A'
          : String(ctx.from.id) === String(challenge.targetUserId)
            ? 'B'
            : null;
        if (!side) return answerLocalized(ctx, 'You are not a player in this duel.', { show_alert: true });

        let move;
        try {
          move = rps.normalizeMove(moveValue);
        } catch (_) {
          return answerLocalized(ctx, 'Invalid move.', { show_alert: true });
        }

        if (challenge.moves?.[side]) {
          return answerLocalized(ctx, 'You have already selected your move.', { show_alert: true });
        }

        challenge.moves[side] = move;
        await answerLocalized(ctx, 'Your move is locked. Waiting for the opponent.');

        if (challenge.moves.A && challenge.moves.B) {
          return withLock(`rps:settle:${id}`, () => settleRpsChallenge(bot, challenge));
        }
        return;
      });

      if (action === 'RETRY') return withLock(`rps:settle:${id}`, async () => {
        if (
          String(ctx.from.id) !== String(challenge.challengerId) &&
          String(ctx.from.id) !== String(challenge.targetUserId)
        ) {
          return answerLocalized(ctx, 'You are not a player in this duel.', { show_alert: true });
        }
        if (challenge.status !== 'SETTLING') {
          return answerLocalized(ctx, 'There is no pending settlement to retry.', { show_alert: true });
        }
        await answerLocalized(ctx, 'Retrying the same settlement safely...');
        return settleRpsChallenge(bot, challenge);
      });

      return answerLocalized(ctx, 'Unknown RPS action.', { show_alert: true });
    }


    if (data.startsWith('BUY:') && bot._bikaHandleBuy) {
      // BUY:R:divine -> R:divine
      // BUY:HOME -> HOME
      return bot._bikaHandleBuy(ctx, data.slice(4));
    }

    if (data.startsWith('DICE:')) {
      const [, action, ...rest] = data.split(':');
      const id = rest.join(':');
      const challenge = game.getDice(id);
      if (!challenge) return answerLocalized(ctx, 'Challenge expired', { show_alert: true });
      if (action === 'CANCEL') {
        if (ctx.from.id !== challenge.challengerId) return answerLocalized(ctx, 'Only challenger can cancel', { show_alert: true });
        game.delDice(id);
        await answerLocalized(ctx, 'Cancelled');
        return editChallengeHTML(bot, challenge, '❌ <b>Dice Duel Cancelled</b>');
      }
      if (action === 'ACCEPT') return withLock(`dice:${id}`, async () => {
        if (ctx.from.id !== challenge.targetUserId) return answerLocalized(ctx, 'Only the challenged player can accept this duel.', { show_alert: true });
        await answerLocalized(ctx, 'Rolling dice...');
        const challenger = await getUser(challenge.challengerId);
        const target = await getUser(challenge.targetUserId);
        if (!challenger || !target || Number(challenger.balance || 0) < challenge.bet || Number(target.balance || 0) < challenge.bet) {
          game.delDice(id);
          return editChallengeHTML(bot, challenge, '⚠️ Challenge failed because a player has insufficient balance.');
        }
        try {
          const treasury = await getTreasury();
          const result = await dice.roll(ctx, challenger, target, treasury?.vipWinRate);
          const pot = challenge.bet * 2;
          const payout = Math.floor(pot * (1 - HOUSE_CUT_PERCENT));
          const winnerId = result.winner === 'TIE' ? null : result.winner === 'A' ? challenge.challengerId : challenge.targetUserId;
          await settleDuel({ duelId: id, typePrefix: 'dice', challengerId: challenge.challengerId, targetUserId: challenge.targetUserId, winnerUserId: winnerId, bet: challenge.bet, payout, meta: { pot, d1: result.d1, d2: result.d2 } });
          game.delDice(id);
          if (result.winner === 'TIE') {
            return editChallengeHTML(bot, challenge, `🎲 <b>Dice Result</b>\n` + `${mentionHtml(challenge.challenger)} → <b>${result.d1}</b>\n` + `${mentionHtml(challenge.target)} → <b>${result.d2}</b>\n` + `🤝 TIE — refund ပြန်ပေးပြီးပါပြီ။`);
          }
          return editChallengeHTML(bot, challenge, `🎲 <b>Dice Result</b>\n` + `${mentionHtml(challenge.challenger)} → <b>${result.d1}</b>\n` + `${mentionHtml(challenge.target)} → <b>${result.d2}</b>\n` + `🏆 Winner: ${result.winner === 'A' ? mentionHtml(challenge.challenger) : mentionHtml(challenge.target)}\n` + `✅ Winner gets: <b>${fmt(payout)}</b> ${COIN}`);
        } catch (err) {
          return editChallengeHTML(bot, challenge, `⚠️ <b>Dice Duel Error</b>\n━━━━━━━━━━━━\n${String(err?.message || 'Settlement failed')}`);
        }
      });
      return answerLocalized(ctx, 'OK');
    }

    if (data.startsWith('SHAN:')) {
      const [, action, ...rest] = data.split(':');
      const id = rest.join(':');
      const challenge = game.getShan(id);
      if (!challenge) return answerLocalized(ctx, 'Challenge expired', { show_alert: true });
      if (action === 'CANCEL') {
        if (ctx.from.id !== challenge.challengerId) return answerLocalized(ctx, 'Only challenger can cancel', { show_alert: true });
        game.delShan(id);
        await answerLocalized(ctx, 'Cancelled');
        return editChallengeHTML(bot, challenge, '❌ <b>Shan Duel Cancelled</b>');
      }
      if (action === 'ACCEPT') return withLock(`shan:${id}`, async () => {
        if (ctx.from.id !== challenge.targetUserId) return answerLocalized(ctx, 'ဒီ duel ကို reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်', { show_alert: true });
        await answerLocalized(ctx, 'Dealing cards...');
        const challenger = await getUser(challenge.challengerId);
        const target = await getUser(challenge.targetUserId);
        if (!challenger || !target || Number(challenger.balance || 0) < challenge.bet || Number(target.balance || 0) < challenge.bet) {
          game.delShan(id);
          return editChallengeHTML(bot, challenge, '⚠️ Balance မလုံလောက်လို့ challenge failed.');
        }
        try {
          const treasury = await getTreasury();
          const round = dealShanWithVip(challenger, target, treasury?.vipWinRate);
          const pot = challenge.bet * 2;
          const payout = Math.floor(pot * (1 - HOUSE_CUT_PERCENT));
          await editChallengeHTML(bot, challenge, shanRevealText(challenge, round, 1, '🂠 First card dealt...'));
          await sleep(650);
          await editChallengeHTML(bot, challenge, shanRevealText(challenge, round, 2, '🂠 Second card dealt...'));
          await sleep(650);
          await editChallengeHTML(bot, challenge, shanRevealText(challenge, round, 3, '✨ All cards revealed...'));
          await sleep(650);
          const winnerId = round.result.winner === 'TIE' ? null : round.result.winner === 'A' ? challenge.challengerId : challenge.targetUserId;
          await settleDuel({ duelId: id, typePrefix: 'shan', challengerId: challenge.challengerId, targetUserId: challenge.targetUserId, winnerUserId: winnerId, bet: challenge.bet, payout, meta: { pot, vipWinRate: round.vipMeta?.vipWinRate, vipApplied: !!round.vipMeta?.vipApplied, vipSide: round.vipMeta?.vipSide || null, fairWinner: round.vipMeta?.fairWinner || null } });
          game.delShan(id);
          return editChallengeHTML(bot, challenge, shanResultText(challenge, round, payout));
        } catch (err) {
          return editChallengeHTML(bot, challenge, `⚠️ <b>Shan Duel Error</b>\n━━━━━━━━━━━━\n${String(err?.message || 'Settlement failed')}`);
        }
      });
      return answerLocalized(ctx, 'OK');
    }

    return next();
  });
};
