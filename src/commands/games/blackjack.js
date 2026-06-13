'use strict';

const { COIN, BLACKJACK } = require('../../config/constants');
const {
  getUser,
  userPayToTreasury,
  treasuryPayToUser,
} = require('../../services/economyService');
const { checkCooldown } = require('../../services/cooldownService');
const { getDb } = require('../../config/database');
const { ensureTreasury, isOwner } = require('../../services/treasuryService');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { isGroupChat } = require('../../utils/helpers');

const activeGames = new Map();
const activeUsers = new Map();

const ACTION_TIMEOUT_MS = Number(process.env.BLACKJACK_ACTION_TIMEOUT_MS || 90_000);
const BJ_RTP_SETTING_KEY = 'blackjack_rtp';
const DEFAULT_BJ_RTP = Math.max(0, Math.min(100, Number(process.env.BLACKJACK_DEFAULT_RTP || 50)));
const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
const SUITS = Object.freeze(['♠️', '♥️', '♦️', '♣️']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeGameId() {
  return `bj${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function activeUserKey(chatId, userId) {
  return `${chatId}:${userId}`;
}


function clampPercent(value, fallback = DEFAULT_BJ_RTP) {
  const n = Number(String(value ?? '').replace('%', '').trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

function bjRtpCollection() {
  return getDb().collection('config');
}

async function getBjRtp() {
  const doc = await bjRtpCollection().findOne({ key: BJ_RTP_SETTING_KEY });
  return clampPercent(doc?.winRate, DEFAULT_BJ_RTP);
}

async function setBjRtp(winRate, updatedByUserId) {
  const finalRate = clampPercent(winRate);
  const now = new Date();

  await bjRtpCollection().updateOne(
    { key: BJ_RTP_SETTING_KEY },
    {
      $set: {
        key: BJ_RTP_SETTING_KEY,
        winRate: finalRate,
        updatedByUserId: updatedByUserId || null,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return finalRate;
}

async function requireOwner(ctx) {
  const treasury = await ensureTreasury();

  if (!isOwner(ctx, treasury)) {
    await replyHTML(ctx, '⛔ Owner only command ပါ။');
    return null;
  }

  return treasury;
}

function successButton(text, callbackData) {
  return {
    text,
    callback_data: callbackData,
    style: 'success',
  };
}

function actionKeyboard(gameId) {
  return {
    inline_keyboard: [
      [
        successButton('🃏 Hit / ထပ်ဆွဲမယ်', `BJ:HIT:${gameId}`),
        primaryButton('✋ Stand / ရပ်မယ်', `BJ:STAND:${gameId}`),
      ],
    ],
  };
}

function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }

  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }

  return deck;
}

function drawCard(game) {
  if (!game.deck.length) {
    game.deck = createDeck();
  }

  return game.deck.pop();
}

function cardValue(card) {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.rank)) return 10;
  return Number(card.rank) || 0;
}


function card(rank, suit = '♠️') {
  return { rank: String(rank), suit };
}

function handForTotal(total) {
  const value = Math.max(4, Math.min(21, Number(total) || 17));

  if (value === 21) return [card('A'), card('K', '♥️')];
  if (value >= 17) return [card('K'), card(String(value - 10), '♥️')];
  if (value >= 12) return [card('7'), card(String(value - 7), '♥️')];
  return [card(String(Math.max(2, value - 2))), card('2', '♥️')];
}

function bustHand() {
  return [card('K'), card('9', '♥️'), card('5', '♦️')];
}

function chooseBjTargetResult(game, fairResult) {
  const playerValue = handValue(game.player);

  if (playerValue > 21) return 'LOSE';
  if (isNaturalBlackjack(game.player) || isNaturalBlackjack(game.dealer)) return fairResult;

  const shouldWin = Math.random() * 100 < clampPercent(game.bjRtpWinRate);

  if (shouldWin) return 'WIN';
  if (playerValue >= 21) return 'PUSH';
  return 'LOSE';
}

function forceDealerForTarget(game, targetResult) {
  const playerValue = handValue(game.player);

  if (playerValue > 21) return;

  if (targetResult === 'WIN') {
    if (playerValue >= 18 && playerValue <= 21) {
      game.dealer = handForTotal(playerValue - 1);
    } else {
      game.dealer = bustHand();
    }
    return;
  }

  if (targetResult === 'LOSE') {
    if (playerValue < 21) {
      game.dealer = handForTotal(Math.max(17, Math.min(21, playerValue + 1)));
    } else {
      game.dealer = handForTotal(21);
    }
    return;
  }

  if (targetResult === 'PUSH') {
    if (playerValue >= 17 && playerValue <= 21) {
      game.dealer = handForTotal(playerValue);
    } else {
      game.dealer = handForTotal(Math.max(17, playerValue + 1));
    }
  }
}

function handValue(cards) {
  let total = 0;
  let aces = 0;

  for (const card of cards) {
    total += cardValue(card);
    if (card.rank === 'A') aces += 1;
  }

  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }

  return total;
}

function isNaturalBlackjack(cards) {
  return cards.length === 2 && handValue(cards) === 21;
}

function renderCards(cards) {
  return cards.map((card) => `${card.rank}${card.suit}`).join('  ');
}

function renderHiddenCards(cards) {
  return cards.map(() => '🂠').join('  ');
}

function gameTableText(game, revealDealer, note) {
  const playerValue = handValue(game.player);
  const dealerValue = revealDealer ? handValue(game.dealer) : null;

  return (
    `🃏 <b>Blackjack</b>\n` +
    `━━━━━━━━━━━━\n` +
    `User: <b>${renderCards(game.player)}</b> (${playerValue})\n` +
    `Dealer: <b>${revealDealer ? renderCards(game.dealer) : renderHiddenCards(game.dealer)}</b>${revealDealer ? ` (${dealerValue})` : ''}\n` +
    `━━━━━━━━━━━━\n` +
    `${note}`
  );
}

function resultLabel(result) {
  if (result === 'BLACKJACK') return '🏆 BLACKJACK';
  if (result === 'WIN') return '✅ WIN';
  if (result === 'LOSE') return '❌ LOSE';
  if (result === 'PUSH') return '🤝 PUSH';
  return result;
}

function decideResult(game) {
  const playerValue = handValue(game.player);
  const dealerValue = handValue(game.dealer);
  const playerNatural = isNaturalBlackjack(game.player);
  const dealerNatural = isNaturalBlackjack(game.dealer);

  if (playerNatural && dealerNatural) return 'PUSH';
  if (playerNatural) return 'BLACKJACK';
  if (dealerNatural) return 'LOSE';
  if (playerValue > 21) return 'LOSE';
  if (dealerValue > 21) return 'WIN';
  if (playerValue > dealerValue) return 'WIN';
  if (playerValue < dealerValue) return 'LOSE';
  return 'PUSH';
}

function payoutFor(result, bet) {
  if (result === 'BLACKJACK') return Math.floor(bet * 2.5);
  if (result === 'WIN') return bet * 2;
  if (result === 'PUSH') return bet;
  return 0;
}

function blackjackResultText(game, result, payout) {
  return (
    `🃏 <b>Blackjack</b>\n` +
    `━━━━━━━━━━━━\n` +
    `User: <b>${renderCards(game.player)}</b> (${handValue(game.player)})\n` +
    `Dealer: <b>${renderCards(game.dealer)}</b> (${handValue(game.dealer)})\n` +
    `━━━━━━━━━━━━\n` +
    `Result: <b>${resultLabel(result)}</b>\n` +
    `BJ RTP: <b>${fmt(game.bjRtpWinRate ?? DEFAULT_BJ_RTP)}%</b>\n` +
    `Bet: <b>${fmt(game.bet)}</b> ${COIN}\n` +
    `Payout: <b>${fmt(payout)}</b> ${COIN}\n` +
    `Net: <b>${fmt(payout - game.bet)}</b> ${COIN}`
  );
}

function expiredText(game) {
  return (
    `⌛ <b>Blackjack Expired</b>\n` +
    `━━━━━━━━━━━━\n` +
    `User: <b>${renderCards(game.player)}</b> (${handValue(game.player)})\n` +
    `Dealer: <b>${renderHiddenCards(game.dealer)}</b>\n` +
    `━━━━━━━━━━━━\n` +
    `အချိန်ကုန်သွားလို့ bet refund ပြန်ပေးထားပါတယ်။`
  );
}

async function editGameMessage(bot, game, html, replyMarkup) {
  return bot.telegram.editMessageText(game.chatId, game.messageId, undefined, html, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

function clearGame(gameId) {
  const game = activeGames.get(gameId);

  if (!game) return null;

  if (game.timeoutHandle) clearTimeout(game.timeoutHandle);
  activeGames.delete(gameId);
  activeUsers.delete(activeUserKey(game.chatId, game.userId));

  return game;
}

async function expireGame(bot, gameId) {
  const game = clearGame(gameId);
  if (!game || game.settled) return;

  game.settled = true;

  try {
    await treasuryPayToUser(game.userId, game.bet, {
      type: 'blackjack_refund',
      bet: game.bet,
      reason: 'blackjack_action_timeout',
    });
  } catch (_) {}

  try {
    await editGameMessage(bot, game, expiredText(game), undefined);
  } catch (_) {}
}

async function settleGame(bot, game, result) {
  const payout = payoutFor(result, game.bet);

  clearGame(game.id);
  game.settled = true;

  if (payout > 0) {
    try {
      await treasuryPayToUser(game.userId, payout, {
        type: 'blackjack_win',
        bet: game.bet,
        payout,
        result,
        bjRtpWinRate: game.bjRtpWinRate,
        fairResult: game.fairResult || result,
        rtpTargetResult: game.rtpTargetResult || result,
      });
    } catch (_) {
      try {
        await treasuryPayToUser(game.userId, game.bet, {
          type: 'blackjack_refund',
          bet: game.bet,
          reason: 'blackjack_payout_failed',
        });
      } catch (_) {}

      return editGameMessage(
        bot,
        game,
        `⚠️ <b>Blackjack Payout Error</b>\n` +
          `━━━━━━━━━━━━\n` +
          `Payout error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`,
        undefined
      );
    }
  }

  return editGameMessage(bot, game, blackjackResultText(game, result, payout), undefined);
}

async function dealerPlayAndSettle(bot, game) {
  const fairBeforeRtp = decideResult(game);
  const targetResult = chooseBjTargetResult(game, fairBeforeRtp);
  forceDealerForTarget(game, targetResult);

  await editGameMessage(bot, game, gameTableText(game, true, '✨ Dealer cards revealed...'), undefined);
  await sleep(600);

  while (handValue(game.dealer) < 17) {
    game.dealer.push(drawCard(game));

    await editGameMessage(bot, game, gameTableText(game, true, '🃏 Dealer draws a card...'), undefined);
    await sleep(600);
  }

  const result = decideResult(game);
  game.fairResult = fairBeforeRtp;
  game.rtpTargetResult = targetResult;
  return settleGame(bot, game, result);
}

module.exports = (bot) => {
  bot.command('setbjrtp', async (ctx) => {
    if (!(await requireOwner(ctx))) return;

    const parts = String(ctx.message?.text || '').trim().split(/\s+/);
    const rateInput = parts[1];
    const rate = Number(String(rateInput || '').replace('%', '').trim());

    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      return replyHTML(
        ctx,
        'အသုံးပြုပုံမှားနေပါတယ်။\n\n' +
          'ဥပမာ: <code>/setbjrtp 60</code> သို့မဟုတ် <code>/setbjrtp 60%</code>\n' +
          'RTP ကို <b>0</b> ကနေ <b>100</b> အတွင်းသတ်မှတ်ပါ။'
      );
    }

    const finalRate = await setBjRtp(rate, ctx.from?.id);

    return replyHTML(
      ctx,
      '✅ <b>Blackjack RTP Updated</b>\n' +
        '━━━━━━━━━━━━\n' +
        `BJ RTP: <b>${fmt(finalRate)}%</b>`
    );
  });

  bot.command('bjrtp', async (ctx) => {
    const rate = await getBjRtp();

    return replyHTML(
      ctx,
      '🃏 <b>Blackjack RTP</b>\n' +
        '━━━━━━━━━━━━\n' +
        `Current BJ RTP: <b>${fmt(rate)}%</b>`
    );
  });

  bot.hears(/^\.(blackjack|bj)\s+(\d+)\s*$/i, async (ctx) => {
    if (!isGroupChat(ctx)) {
      return replyHTML(ctx, 'ℹ️ group ထဲမှာပဲ သုံးနိုင်ပါတယ်။');
    }

    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const commandMessageId = ctx.message?.message_id;
    const bet = Number(ctx.match?.[2]);

    if (!userId || !chatId) return;

    if (activeUsers.has(activeUserKey(chatId, userId))) {
      return replyHTML(ctx, '⏳ သင့် Blackjack round လက်ရှိ run နေပါတယ်။');
    }

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
    let game = null;

    try {
      await userPayToTreasury(userId, bet, {
        type: 'blackjack_bet',
        chatId,
      });

      betTaken = true;

      const deck = createDeck();
      const bjRtpWinRate = await getBjRtp();

      game = {
        id: makeGameId(),
        userId,
        chatId,
        messageId: null,
        bet,
        bjRtpWinRate,
        deck,
        player: [],
        dealer: [],
        settled: false,
        timeoutHandle: null,
      };

      game.player.push(drawCard(game));
      game.dealer.push(drawCard(game));
      game.player.push(drawCard(game));
      game.dealer.push(drawCard(game));

      const sent = await replyHTML(
        ctx,
        gameTableText(
          game,
          false,
          'User ကဒ် ၂ ကဒ်ဝေပြီးပါပြီ။ ထပ်ဆွဲမလား၊ ဒီမှာတင်ရပ်မလား ရွေးပါ။'
        ),
        {
          reply_to_message_id: commandMessageId,
          reply_markup: actionKeyboard(game.id),
        }
      );

      if (!sent?.message_id) {
        throw new Error('BLACKJACK_MESSAGE_FAILED');
      }

      game.messageId = sent.message_id;
      game.timeoutHandle = setTimeout(() => {
        expireGame(bot, game.id).catch(() => {});
      }, ACTION_TIMEOUT_MS);

      activeGames.set(game.id, game);
      activeUsers.set(activeUserKey(chatId, userId), game.id);
      betTaken = false;

      if (isNaturalBlackjack(game.player) || isNaturalBlackjack(game.dealer)) {
        await sleep(650);
        const result = decideResult(game);
        return settleGame(bot, game, result);
      }
    } catch (err) {
      if (game?.id) clearGame(game.id);

      if (betTaken) {
        try {
          await treasuryPayToUser(userId, bet, {
            type: 'blackjack_refund',
            bet,
            reason: 'blackjack_runtime_error',
          });
        } catch (_) {}
      }

      return replyHTML(
        ctx,
        `⚠️ <b>Blackjack Error</b>\n` +
          `━━━━━━━━━━━━\n` +
          `Game error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`
      );
    }
  });

  bot.action(/^BJ:(HIT|STAND):([A-Za-z0-9]+)$/i, async (ctx) => {
    const action = String(ctx.match?.[1] || '').toUpperCase();
    const gameId = String(ctx.match?.[2] || '');
    const game = activeGames.get(gameId);

    if (!game) {
      await ctx.answerCbQuery('Blackjack round expired.', { show_alert: true }).catch(() => {});
      return;
    }

    if (ctx.from?.id !== game.userId) {
      await ctx.answerCbQuery('ဒီ Blackjack button ကို သက်ဆိုင်တဲ့ user ပဲနှိပ်နိုင်ပါတယ်။', {
        show_alert: true,
      }).catch(() => {});
      return;
    }

    await ctx.answerCbQuery(action === 'HIT' ? 'Card drawn.' : 'Stand.').catch(() => {});

    try {
      if (action === 'HIT') {
        game.player.push(drawCard(game));

        if (handValue(game.player) > 21) {
          await editGameMessage(bot, game, gameTableText(game, true, '💥 User bust!'), undefined);
          await sleep(500);
          return settleGame(bot, game, 'LOSE');
        }

        return editGameMessage(
          bot,
          game,
          gameTableText(game, false, 'ကဒ်တစ်ကဒ်ထပ်ဆွဲပြီးပါပြီ။ ထပ်ဆွဲမလား၊ ရပ်မလား ရွေးပါ။'),
          actionKeyboard(game.id)
        );
      }

      return dealerPlayAndSettle(bot, game);
    } catch (err) {
      clearGame(game.id);

      try {
        await treasuryPayToUser(game.userId, game.bet, {
          type: 'blackjack_refund',
          bet: game.bet,
          reason: 'blackjack_action_error',
        });
      } catch (_) {}

      try {
        await editGameMessage(
          bot,
          game,
          `⚠️ <b>Blackjack Error</b>\n` +
            `━━━━━━━━━━━━\n` +
            `Game error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`,
          undefined
        );
      } catch (_) {}
    }
  });
};
