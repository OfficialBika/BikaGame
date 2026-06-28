'use strict';

const { COIN, MINES } = require('../../config/constants');
const {
  getUser,
  userPayToTreasury,
  treasuryPayToUser,
} = require('../../services/economyService');
const { getTreasury } = require('../../services/treasuryService');
const { checkCooldown } = require('../../services/cooldownService');
const { recordDailyTournament } = require('../../services/tournamentService');
const { replyHTML, editByIds } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { isGroupChat, mentionHtml } = require('../../utils/helpers');

const activeGames = new Map();
const activeUsers = new Map();

const BOARD_SIZE = Number(MINES?.boardSize || 5);
const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
const DEFAULT_MINES = Number(MINES?.defaultMines || 3);
const ALLOWED_MINES = Array.isArray(MINES?.allowedMines) && MINES.allowedMines.length
  ? MINES.allowedMines.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n < TOTAL_CELLS)
  : [3, 5, 7, 10];
const ACTION_TIMEOUT_MS = Number(MINES?.actionTimeoutMs || process.env.MINES_ACTION_TIMEOUT_MS || 120_000);
const MAX_ACTIVE = Number(MINES?.maxActive || process.env.MINES_MAX_ACTIVE || 30);
const HOUSE_EDGE = Math.max(0, Math.min(0.25, Number(MINES?.houseEdge ?? 0.04)));
const CAP_PERCENT = Math.max(0.05, Math.min(1, Number(MINES?.capPercent || 0.30)));
const MIN_CASHOUT_SAFE_PICKS = Math.max(1, Math.min(TOTAL_CELLS - 1, Number(MINES?.minCashoutSafePicks || process.env.MINES_MIN_CASHOUT_SAFE_PICKS || 2)));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCallbackAnswerer(ctx) {
  let answered = false;

  return async function answerOnce(text, options = {}) {
    if (answered) return;
    answered = true;

    try {
      await ctx.answerCbQuery(text, options);
    } catch (_) {}
  };
}

function makeGameId() {
  return `mn${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function activeUserKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId, allow_sending_without_reply: true } : {};
}

function clampBet(value) {
  const bet = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isInteger(bet) ? bet : NaN;
}

function parseMineCount(value) {
  const input = Number(String(value || '').replace(/,/g, '').trim());
  if (ALLOWED_MINES.includes(input)) return input;
  if (ALLOWED_MINES.includes(DEFAULT_MINES)) return DEFAULT_MINES;
  return ALLOWED_MINES[0] || 3;
}

function parseCommandText(text) {
  const match = String(text || '').trim().match(/^(?:\/mines|\/mine|\.mines|\.mine)(?:@\w+)?\s+(\d[\d,]*)(?:\s+(\d+))?\s*$/i);
  if (!match) return null;
  return {
    bet: clampBet(match[1]),
    mineCount: parseMineCount(match[2]),
  };
}

function createMinePositions(mineCount, firstSafeIndex) {
  const blocked = new Set([Number(firstSafeIndex)]);
  const positions = new Set();

  while (positions.size < mineCount) {
    const index = Math.floor(Math.random() * TOTAL_CELLS);
    if (blocked.has(index)) continue;
    positions.add(index);
  }

  return positions;
}

function calculateMultiplier(safeOpened, mineCount) {
  const opened = Math.max(0, Math.min(TOTAL_CELLS - mineCount, Number(safeOpened) || 0));
  if (opened <= 0) return 1;

  let multiplier = 1;
  const safeCells = TOTAL_CELLS - mineCount;

  for (let i = 0; i < opened; i += 1) {
    multiplier *= (TOTAL_CELLS - i) / Math.max(1, safeCells - i);
  }

  const withHouseEdge = multiplier * (1 - HOUSE_EDGE);
  return Math.max(1.01, Math.floor(withHouseEdge * 100) / 100);
}

function currentMultiplier(game) {
  return calculateMultiplier(game.openedSafe.size, game.mineCount);
}

function canCashOut(game) {
  return game.openedSafe.size >= MIN_CASHOUT_SAFE_PICKS;
}

function cashoutAmount(game) {
  if (!canCashOut(game)) return 0;
  return Math.floor(game.bet * currentMultiplier(game));
}

async function capPayout(game, payout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByCap = Math.floor(ownerBalance * CAP_PERCENT);
  const maxAllowed = Math.max(game.bet, Math.min(ownerBalance, maxByCap > 0 ? maxByCap : ownerBalance));
  return Math.max(0, Math.min(Number(payout) || 0, maxAllowed));
}

function button(text, callbackData, style = 'primary') {
  return { text, callback_data: callbackData, style };
}

function cellButton(game, index, revealAll = false) {
  const isOpened = game.openedSafe.has(index);
  const isMine = game.minePositions?.has(index);
  const row = Math.floor(index / BOARD_SIZE) + 1;
  const col = (index % BOARD_SIZE) + 1;

  if (isOpened) return button('✅', `MINES:NOOP:${game.id}`, 'success');

  if (revealAll && isMine) {
    const label = game.explodedIndex === index ? '💥' : '💣';
    return button(label, `MINES:NOOP:${game.id}`, 'danger');
  }

  if (revealAll) return button('▫️', `MINES:NOOP:${game.id}`, 'primary');

  return button('❔', `MINES:OPEN:${game.id}:${index}`, 'primary');
}

function minesKeyboard(game, revealAll = false) {
  const rows = [];

  for (let row = 0; row < BOARD_SIZE; row += 1) {
    const cells = [];
    for (let col = 0; col < BOARD_SIZE; col += 1) {
      cells.push(cellButton(game, row * BOARD_SIZE + col, revealAll));
    }
    rows.push(cells);
  }

  if (!revealAll && canCashOut(game)) {
    rows.push([
      button(`💰 Cash Out • ${fmt(cashoutAmount(game))} ${COIN}`, `MINES:CASH:${game.id}`, 'success'),
    ]);
  }

  if (!revealAll && !canCashOut(game)) {
    rows.push([
      button('❌ Cancel / Refund', `MINES:CANCEL:${game.id}`, 'danger'),
    ]);
  }

  return { inline_keyboard: rows };
}

function minesText(game, note, revealAll = false, finalPayout = null) {
  const multiplier = currentMultiplier(game).toFixed(2);
  const cashout = finalPayout == null ? cashoutAmount(game) : finalPayout;
  const safeTotal = TOTAL_CELLS - game.mineCount;
  const cashoutLine = finalPayout == null && !revealAll && !canCashOut(game)
    ? `Cash Out: <b>Locked</b> (${MIN_CASHOUT_SAFE_PICKS} safe required)\n`
    : `Cash Out: <b>${fmt(cashout)}</b> ${COIN}\n`;

  return (
    `💣 <b>BIKA Mines</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Player: ${mentionHtml(game.user)}\n` +
    `Bet: <b>${fmt(game.bet)}</b> ${COIN}\n` +
    `Mines: <b>${game.mineCount}</b> / ${TOTAL_CELLS}\n` +
    `Safe Opened: <b>${game.openedSafe.size}</b> / ${safeTotal}\n` +
    `Multiplier: <b>x${multiplier}</b>\n` +
    cashoutLine +
    `━━━━━━━━━━━━\n` +
    `${note}${revealAll ? '\n\n<i>Board revealed.</i>' : ''}`
  );
}

function clearGame(gameId) {
  const game = activeGames.get(gameId);
  if (!game) return null;

  if (game.timeoutHandle) clearTimeout(game.timeoutHandle);
  activeGames.delete(gameId);
  activeUsers.delete(activeUserKey(game.chatId, game.userId));
  return game;
}

async function recordMinesTournament(game, payout, result) {
  try {
    await recordDailyTournament({
      game: 'mines',
      chatId: game.chatId,
      user: game.user,
      bet: game.bet,
      payout,
      net: payout - game.bet,
      multiplier: currentMultiplier(game),
      meta: {
        result,
        mines: game.mineCount,
        safeOpened: game.openedSafe.size,
      },
    });
  } catch (err) {
    console.warn('MINES_TOURNAMENT_RECORD_FAILED:', err?.message || err);
  }
}

async function payoutAndSettle(bot, game, reason) {
  const rawPayout = cashoutAmount(game);
  const payout = await capPayout(game, rawPayout);

  clearGame(game.id);
  game.settled = true;

  try {
    await treasuryPayToUser(game.userId, payout, {
      type: 'mines_win',
      bet: game.bet,
      payout,
      rawPayout,
      multiplier: currentMultiplier(game),
      mines: game.mineCount,
      safeOpened: game.openedSafe.size,
      reason,
    });
  } catch (err) {
    try {
      await treasuryPayToUser(game.userId, game.bet, {
        type: 'mines_refund',
        bet: game.bet,
        reason: 'mines_payout_failed',
      });
    } catch (_) {}

    return editByIds(
      bot,
      game.chatId,
      game.messageId,
      `⚠️ <b>Mines Payout Error</b>\n` +
        `━━━━━━━━━━━━\n` +
        `Payout error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`,
      { reply_markup: minesKeyboard(game, true) }
    );
  }

  recordMinesTournament(game, payout, reason).catch(() => {});

  return editByIds(
    bot,
    game.chatId,
    game.messageId,
    minesText(game, `✅ <b>Cash Out Success!</b>\nNet: <b>${fmt(payout - game.bet)}</b> ${COIN}`, true, payout),
    { reply_markup: minesKeyboard(game, true) }
  );
}

async function expireGame(bot, gameId) {
  const game = activeGames.get(gameId);
  if (!game || game.settled) return;

  if (game.processing) {
    game.timeoutHandle = setTimeout(() => expireGame(bot, gameId).catch(() => {}), 5000);
    return;
  }

  if (canCashOut(game)) {
    return payoutAndSettle(bot, game, 'timeout_auto_cashout');
  }

  clearGame(game.id);
  game.settled = true;

  try {
    await treasuryPayToUser(game.userId, game.bet, {
      type: 'mines_refund',
      bet: game.bet,
      reason: game.openedSafe.size > 0 ? 'mines_timeout_before_cashout_unlock' : 'mines_timeout_no_pick',
    });
  } catch (_) {}

  return editByIds(
    bot,
    game.chatId,
    game.messageId,
    minesText(game, '⌛ Cash Out unlock မဖြစ်သေးခင် အချိန်ကုန်သွားလို့ bet refund ပြန်ပေးထားပါတယ်။', true, game.bet),
    { reply_markup: minesKeyboard(game, true) }
  );
}

async function startMines(ctx, bot, parsed) {
  const options = replyOptions(ctx);

  if (!isGroupChat(ctx)) {
    return replyHTML(ctx, 'ℹ️ <code>.mines</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။', options);
  }

  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const bet = parsed?.bet;
  const mineCount = parsed?.mineCount || DEFAULT_MINES;

  if (!userId || !chatId) return null;

  if (
    !Number.isInteger(bet) ||
    bet < Number(MINES?.minBet || 50) ||
    bet > Number(MINES?.maxBet || 200000)
  ) {
    return replyHTML(
      ctx,
      `💣 <b>BIKA Mines</b>\n` +
        `━━━━━━━━━━━━\n` +
        `Usage: <code>.mines 1000</code> သို့မဟုတ် <code>.mines 1000 5</code>\n` +
        `Min: <b>${fmt(MINES?.minBet || 50)}</b> ${COIN}\n` +
        `Max: <b>${fmt(MINES?.maxBet || 200000)}</b> ${COIN}\n` +
        `Mines: <b>${ALLOWED_MINES.join(' / ')}</b>`,
      options
    );
  }

  if (!ALLOWED_MINES.includes(mineCount)) {
    return replyHTML(ctx, `⚠️ Mines count ကို ${ALLOWED_MINES.join(' / ')} ထဲကပဲရွေးပါ။`, options);
  }

  if (activeUsers.has(activeUserKey(chatId, userId))) {
    return replyHTML(ctx, '⏳ သင့် Mines round လက်ရှိ run နေပါတယ်။ Cash Out သို့မဟုတ် Cancel လုပ်ပြီးမှ ထပ်စပါ။', options);
  }

  if (activeGames.size >= MAX_ACTIVE) {
    return replyHTML(ctx, '⛔ Mines game များနေပါတယ်။ ခဏစောင့်ပြီး ထပ်စမ်းပါ။', options);
  }

  const cooldownSeconds = Math.max(1, Math.ceil(Number(MINES?.cooldownMs || 1200) / 1000));
  const cooldownLeft = checkCooldown(`mines:${userId}`, cooldownSeconds);

  if (cooldownLeft > 0) {
    return replyHTML(ctx, `⏳ ခဏစောင့်ပါ… (${cooldownLeft}s)`, options);
  }

  const user = await getUser(userId);

  if (Number(user?.balance || 0) < bet) {
    return replyHTML(ctx, '❌ Balance မလုံလောက်ပါ။', options);
  }

  let betTaken = false;
  let game = null;

  try {
    await userPayToTreasury(userId, bet, {
      type: 'mines_bet',
      chatId,
      mines: mineCount,
    });
    betTaken = true;

    game = {
      id: makeGameId(),
      userId,
      chatId,
      messageId: null,
      commandMessageId: ctx.message?.message_id || null,
      user: ctx.from,
      bet,
      mineCount,
      minePositions: null,
      openedSafe: new Set(),
      explodedIndex: null,
      settled: false,
      processing: false,
      timeoutHandle: null,
      createdAt: new Date(),
    };

    const sent = await replyHTML(
      ctx,
      minesText(game, `❔ Safe tile ကိုရွေးပါ။ Cash Out က safe ${MIN_CASHOUT_SAFE_PICKS} ခုဖွင့်ပြီးမှပေါ်မယ်။`),
      {
        ...options,
        reply_markup: minesKeyboard(game),
      }
    );

    if (!sent?.message_id) throw new Error('MINES_MESSAGE_FAILED');

    game.messageId = sent.message_id;
    game.timeoutHandle = setTimeout(() => expireGame(bot, game.id).catch(() => {}), ACTION_TIMEOUT_MS);
    activeGames.set(game.id, game);
    activeUsers.set(activeUserKey(chatId, userId), game.id);
    betTaken = false;
    return sent;
  } catch (err) {
    console.error('MINES_START_ERROR:', err?.stack || err?.message || err);

    if (game?.id) clearGame(game.id);

    if (betTaken) {
      try {
        await treasuryPayToUser(userId, bet, {
          type: 'mines_refund',
          bet,
          reason: 'mines_start_error',
        });
      } catch (_) {}
    }

    return replyHTML(
      ctx,
      `⚠️ <b>Mines Error</b>\n` +
        `━━━━━━━━━━━━\n` +
        `Game start error ဖြစ်လို့ bet refund ပြန်ပေးထားပါတယ်။`,
      options
    );
  }
}

module.exports = (bot) => {
  const startFromCommand = async (ctx) => {
    const parsed = parseCommandText(ctx.message?.text);
    return startMines(ctx, bot, parsed);
  };

  bot.command('mines', startFromCommand);
  bot.command('mine', startFromCommand);

  bot.hears(/^\.(mines|mine)\s+\d[\d,]*(?:\s+\d+)?\s*$/i, async (ctx) => {
    const parsed = parseCommandText(ctx.message?.text);
    return startMines(ctx, bot, parsed);
  });

  bot.action(/^MINES:(OPEN|CASH|CANCEL|NOOP):([A-Za-z0-9]+)(?::(\d+))?$/i, async (ctx) => {
    const action = String(ctx.match?.[1] || '').toUpperCase();
    const gameId = String(ctx.match?.[2] || '');
    const cellIndex = Number(ctx.match?.[3]);
    const game = activeGames.get(gameId);
    const answerOnce = createCallbackAnswerer(ctx);

    if (!game) {
      await answerOnce('Mines round expired.', { show_alert: true });
      return;
    }

    if (action === 'NOOP') {
      await answerOnce('Already revealed.');
      return;
    }

    if (ctx.from?.id !== game.userId) {
      await answerOnce('ဒီ Mines button ကို သက်ဆိုင်တဲ့ user ပဲနှိပ်နိုင်ပါတယ်။', {
        show_alert: true,
      });
      return;
    }

    if (game.processing) {
      await answerOnce('Processing... ခဏစောင့်ပါ။');
      return;
    }

    game.processing = true;

    if (action === 'OPEN') {
      await answerOnce('Opening tile...');
    } else if (action === 'CASH') {
      await answerOnce('Cash out...');
    } else if (action === 'CANCEL') {
      await answerOnce('Cancelling...');
    }

    try {
      if (action === 'CANCEL') {
        if (canCashOut(game)) {
          await answerOnce('Cash Out unlock ဖြစ်ပြီးသားဆို Cash Out ပဲလုပ်လို့ရပါတယ်။', { show_alert: true });
          return;
        }

        clearGame(game.id);
        game.settled = true;

        try {
          await treasuryPayToUser(game.userId, game.bet, {
            type: 'mines_refund',
            bet: game.bet,
            reason: game.openedSafe.size > 0 ? 'mines_cancel_before_cashout_unlock' : 'mines_cancel_before_pick',
          });
        } catch (_) {}

        await answerOnce('Cancelled & refunded.');
        return editByIds(
          bot,
          game.chatId,
          game.messageId,
          minesText(game, '❌ Mines round cancelled. Bet refund ပြန်ပေးထားပါတယ်။', true, game.bet),
          { reply_markup: minesKeyboard(game, true) }
        );
      }

      if (action === 'CASH') {
        if (!canCashOut(game)) {
          await answerOnce(`Safe tile အနည်းဆုံး ${MIN_CASHOUT_SAFE_PICKS} ခုဖွင့်ပြီးမှ Cash Out လုပ်ပါ။`, { show_alert: true });
          return;
        }

        await answerOnce('Cash out...');
        return payoutAndSettle(bot, game, 'cashout');
      }

      if (action !== 'OPEN' || !Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= TOTAL_CELLS) {
        await answerOnce('Invalid action.');
        return;
      }

      if (game.openedSafe.has(cellIndex)) {
        await answerOnce('Already opened.');
        return;
      }

      if (!game.minePositions) {
        game.minePositions = createMinePositions(game.mineCount, cellIndex);
      }

      if (game.minePositions.has(cellIndex)) {
        game.explodedIndex = cellIndex;
        clearGame(game.id);
        game.settled = true;

        recordMinesTournament(game, 0, 'mine_hit').catch(() => {});
        await answerOnce('BOOM! Mine hit.');

        return editByIds(
          bot,
          game.chatId,
          game.messageId,
          minesText(game, `💥 <b>BOOM!</b> Mine ထိသွားပါပြီ။\nLost: <b>${fmt(game.bet)}</b> ${COIN}`, true, 0),
          { reply_markup: minesKeyboard(game, true) }
        );
      }

      game.openedSafe.add(cellIndex);
      const safeTotal = TOTAL_CELLS - game.mineCount;

      if (game.openedSafe.size >= safeTotal) {
        await answerOnce('Perfect clear!');
        return payoutAndSettle(bot, game, 'perfect_clear');
      }

      await answerOnce(`Safe! x${currentMultiplier(game).toFixed(2)}`);

      const note = canCashOut(game)
        ? '✅ Safe tile ဖွင့်ပြီးပါပြီ။ ဆက်ရွေးမလား Cash Out လုပ်မလား ရွေးပါ။'
        : `✅ First safe ဖွင့်ပြီးပါပြီ။ Cash Out ပေါ်ဖို့ safe ${MIN_CASHOUT_SAFE_PICKS} ခုလိုပါတယ်။ ဆက်ရွေးပါ သို့မဟုတ် Cancel / Refund လုပ်နိုင်ပါတယ်။`;

      return editByIds(
        bot,
        game.chatId,
        game.messageId,
        minesText(game, note),
        { reply_markup: minesKeyboard(game) }
      );
    } catch (err) {
      console.error('MINES_ACTION_ERROR:', err?.stack || err?.message || err);

      try {
        await answerOnce('Telegram rate limit ဖြစ်နိုင်ပါတယ်။ ခဏစောင့်ပြီး ထပ်နှိပ်ပါ။');
        await editByIds(
          bot,
          game.chatId,
          game.messageId,
          minesText(game, '⚠️ Telegram rate limit ဖြစ်နေပါတယ်။ ခဏစောင့်ပြီး ထပ်နှိပ်ပါ။'),
          { reply_markup: minesKeyboard(game) }
        );
      } catch (editErr) {
        console.error('MINES_ACTION_NOTICE_FAILED:', editErr?.stack || editErr?.message || editErr);
      }
    } finally {
      if (activeGames.has(game.id)) {
        game.processing = false;
      }
    }
  });
};
