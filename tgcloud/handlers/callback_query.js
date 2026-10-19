import { api } from 'sdk';
import { ensureUser } from '../lib/users.js';
import {
  getDiceChallenge, cancelDiceChallenge, claimDiceChallenge, storeDiceRollResult,
  settleDiceChallenge, failDiceChallenge,
} from '../lib/diceDuel.js';
import { createStarsInvoice, STAR_PACKAGES, packageBalance } from '../lib/stars.js';
import {
  crashCashout, minesOpen, minesCashout, blackjackAction, shanDeal,
} from '../lib/game.js';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function diceResultText(session) {
  const state = session?.state || {};
  const result = state.rollResult || {};
  const payout = Number(state.settlement?.payout ?? Math.floor(Number(state.bet || 0) * 2 * 0.98));
  if (result.winner === 'TIE') {
    return '🎲 DICE DUEL RESULT\n━━━━━━━━━━━━\n' +
      state.challengerName + ': 🎲 ' + result.d1 + '\n' +
      state.targetName + ': 🎲 ' + result.d2 + '\n' +
      '🤝 TIE — both bets were refunded.';
  }
  const winnerName = result.winner === 'A' ? state.challengerName : state.targetName;
  return '🎲 DICE DUEL RESULT\n━━━━━━━━━━━━\n' +
    state.challengerName + ': 🎲 ' + result.d1 + '\n' +
    state.targetName + ': 🎲 ' + result.d2 + '\n' +
    '🏆 Winner: ' + winnerName + '\n' +
    '✅ Winner receives: ' + payout.toLocaleString('en-US') + ' Bal';
}

function telegramErrorText(error) {
  const code = String(error?.code || error?.details?.code || error?.message || '');
  const messages = {
    DICE_TARGET_ONLY: 'ဒီ duel ကို reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်။',
    DICE_CANCEL_OWNER_ONLY: 'Challenge ဖန်တီးသူသာ Cancel လုပ်နိုင်ပါတယ်။',
    DICE_BALANCE_INSUFFICIENT: 'Player တစ်ယောက်ရဲ့ Balance မလုံလောက်ပါ။ Dice မပစ်ခဲ့ပါ၊ bet မဖြတ်ခဲ့ပါ။',
    DICE_BUSY: 'Dice challenge များနေပါတယ်။ ခဏနေပြီး ပြန်ကြိုးစားပါ။',
    DICE_CHALLENGE_NOT_FOUND: 'Dice challenge သက်တမ်းကုန်သွားပါပြီ။',
    DICE_NOT_READY: 'Challenge ကို ပြင်ဆင်နေဆဲပါ။ ခဏနေပြီး ပြန်နှိပ်ပါ။',
    USER_INSUFFICIENT: 'Balance မလုံလောက်ပါ။ Bet မဖြတ်ခဲ့ပါ။',
  };
  return messages[code] || 'Dice Duel ကို လုံခြုံစွာ မပြီးမြောက်နိုင်ပါ။';
}

async function sendDiceValue(chatId, replyToMessageId) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await api.sendDice({
        chat_id: chatId,
        emoji: '🎲',
        reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true },
      });
      const value = Number(response?.dice?.value ?? response?.result?.dice?.value);
      if (Number.isInteger(value) && value >= 1 && value <= 6) return value;
      throw new Error('TELEGRAM_DICE_VALUE_MISSING');
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      const retryAfter = Number(
        error?.response?.parameters?.retry_after ??
        error?.parameters?.retry_after ??
        error?.error?.parameters?.retry_after ?? 0
      );
      await sleep(retryAfter > 0 ? retryAfter * 1000 + 250 : 350 * attempt);
    }
  }
  throw lastError || new Error('TELEGRAM_DICE_SEND_FAILED');
}

async function editDiceMessage(message, text, replyMarkup = { inline_keyboard: [] }) {
  if (!message?.chat?.id || !message?.message_id) return;
  return api.editMessageText({
    chat_id: message.chat.id,
    message_id: message.message_id,
    text,
    reply_markup: replyMarkup,
  });
}

function tileRow(start, end) {
  return Array.from({ length: end - start + 1 }, (_, offset) => {
    const index = start + offset;
    return { text: String(index + 1), callback_data: 'mines:open:' + index };
  });
}

function minesKeyboard() {
  return {
    inline_keyboard: [
      tileRow(0, 4),
      tileRow(5, 9),
      [{ text: '💰 CASH OUT', callback_data: 'mines:cashout' }],
    ],
  };
}

export default async function (query) {
  const user = query?.from;
  const message = query?.message;
  if (!user?.id) return;

  const data = String(query?.data || '');
  try {
    await ensureUser(user);
    const [game, action, arg] = data.split(':');
    let text = 'Done.';
    let markup;

    if (game === 'dice' && (action === 'accept' || action === 'cancel')) {
      let callbackAnswered = false;
      try {
        let session = await getDiceChallenge(arg);
        if (!session) {
          await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Challenge expired.', show_alert: true });
          return;
        }

        // Even the recovery/resume path is restricted to the intended target.
        // A public inline button must not let unrelated users trigger settlement.
        if (action === 'accept' && Number(user.id) !== Number(session.state?.targetUserId)) {
          await api.answerCallbackQuery({
            callback_query_id: query.id,
            text: 'ဒီ duel ကို reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်။',
            show_alert: true,
          });
          return;
        }

        if (action === 'cancel') {
          const cancelled = await cancelDiceChallenge(arg, user.id);
          await api.answerCallbackQuery({
            callback_query_id: query.id,
            text: cancelled.ok ? 'Challenge cancelled.' : 'Challenge is no longer open.',
          });
          if (cancelled.ok) {
            await editDiceMessage(message, '❌ DICE DUEL CANCELLED\nNo bet was placed.');
          } else if (cancelled.status === 'expired' || session.status === 'expired') {
            await editDiceMessage(message, '⌛ DICE DUEL EXPIRED\nNo bet was placed.');
          }
          return;
        }

        if (session.status === 'settled') {
          await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already settled.' });
          callbackAnswered = true;
          await editDiceMessage(message, diceResultText(session));
          return;
        }
        if (session.status === 'expired' || session.status === 'cancelled' || session.status === 'failed') {
          await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Challenge is no longer open.', show_alert: true });
          callbackAnswered = true;
          await editDiceMessage(message, session.status === 'expired'
            ? '⌛ DICE DUEL EXPIRED\nNo bet was placed.'
            : session.status === 'cancelled'
              ? '❌ DICE DUEL CANCELLED\nNo bet was placed.'
              : '⚠️ DICE DUEL FAILED SAFELY\nNo bet was placed.');
          return;
        }

        if (session.status === 'rolling' && session.state?.rollResult) {
          await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Resuming safe settlement...' });
          callbackAnswered = true;
          const settled = await settleDiceChallenge(arg);
          await editDiceMessage(message, diceResultText(settled.session));
          return;
        }

        const claimed = await claimDiceChallenge(arg, user.id);
        session = claimed.session || session;
        if (claimed.expired) {
          await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Challenge expired.', show_alert: true });
          callbackAnswered = true;
          await editDiceMessage(message, '⌛ DICE DUEL EXPIRED\nNo bet was placed.');
          return;
        }
        if (!claimed.claimed) {
          if (session?.status === 'rolling' && session.state?.rollResult) {
            await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Resuming safe settlement...' });
            callbackAnswered = true;
            const settled = await settleDiceChallenge(arg);
            await editDiceMessage(message, diceResultText(settled.session));
            return;
          }
          await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Already accepted or being processed.', show_alert: true });
          callbackAnswered = true;
          return;
        }

        await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Rolling real Telegram dice...' });
        callbackAnswered = true;
        try {
          const d1 = await sendDiceValue(message.chat.id, message.message_id);
          await sleep(900);
          const d2 = await sendDiceValue(message.chat.id, message.message_id);
          const rollResult = { d1, d2, winner: d1 > d2 ? 'A' : d2 > d1 ? 'B' : 'TIE' };
          await storeDiceRollResult(arg, rollResult);
          const settled = await settleDiceChallenge(arg);
          await editDiceMessage(message, diceResultText(settled.session));
        } catch (error) {
          const latest = await getDiceChallenge(arg);
          if (!latest?.state?.rollResult) {
            await failDiceChallenge(arg);
            await editDiceMessage(message, '⚠️ DICE DUEL FAILED SAFELY\nTelegram dice could not be completed. No bet was placed.');
          } else if (error?.code === 'USER_INSUFFICIENT' || String(error?.message || '').includes('USER_INSUFFICIENT')) {
            await failDiceChallenge(arg, true);
            await editDiceMessage(message, '⚠️ DICE DUEL CANCELLED SAFELY\nA player no longer has enough balance. No bet was deducted.');
          } else {
            await editDiceMessage(
              message,
              '⚠️ Dice results were saved. Settlement can be retried safely; no duplicate payout will occur.',
              { inline_keyboard: [[{ text: '🔄 Resume settlement', callback_data: 'dice:accept:' + arg }]] },
            );
          }
        }
      } catch (error) {
        console.error('BIKA_SERVERLESS_DICE_CALLBACK_FAILED', {
          action,
          challengeId: arg,
          error: String(error?.message || error),
        });
        if (!callbackAnswered) {
          await api.answerCallbackQuery({
            callback_query_id: query.id,
            text: telegramErrorText(error),
            show_alert: true,
          });
        } else {
          try { await editDiceMessage(message, telegramErrorText(error)); } catch (_) {}
        }
      }
      return;
    }

    if (game === 'stars' && action === 'buy') {
      const stars = Number(arg);
      if (message?.chat?.type !== 'private') throw new Error('STARS_PRIVATE_CHAT_REQUIRED');
      if (!STAR_PACKAGES.includes(stars)) throw new Error('INVALID_STARS_PACKAGE');
      await createStarsInvoice(user.id, stars);
      text = '⭐ Invoice sent: ' + stars + ' Stars → ' + packageBalance(stars).toLocaleString() + ' Bal';
    } else if (game === 'crash' && action === 'cashout') {
      const result = await crashCashout(user.id);
      text = '💰 Cash Out x' + result.multiplier + ' — +' + result.payout + ' $';
    } else if (game === 'mines' && action === 'open') {
      const result = await minesOpen(user.id, Number(arg));
      text = result.exploded
        ? '💥 Mine! Round lost.'
        : '💎 Safe tile — x' + result.multiplier;
      if (result.active) markup = minesKeyboard();
    } else if (game === 'mines' && action === 'cashout') {
      const result = await minesCashout(user.id);
      text = '💰 Mines Cash Out x' + result.multiplier + ' — +' + result.payout + ' $';
    } else if (game === 'bj' && (action === 'hit' || action === 'stand')) {
      const result = await blackjackAction(user.id, arg, action);
      text = '🂡 Blackjack — ' + ((result.player?.cards || []).map((card) => card.r + card.s).join(' '));
      if (result.active) {
        markup = {
          inline_keyboard: [[
            { text: 'HIT', callback_data: 'bj:hit:' + arg },
            { text: 'STAND', callback_data: 'bj:stand:' + arg },
          ]],
        };
      }
    } else if (game === 'shan' && (action === 'draw' || action === 'stay')) {
      const result = await shanDeal(user.id, arg, action);
      text = '🎴 Shan — ' + ((result.player?.cards || []).map((card) => card.r + card.s).join(' '));
      if (result.active) {
        markup = {
          inline_keyboard: [[
            { text: 'DRAW', callback_data: 'shan:draw:' + arg },
            { text: 'STAY', callback_data: 'shan:stay:' + arg },
          ]],
        };
      }
    } else {
      text = 'Unsupported preview action.';
    }

    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: text.slice(0, 200),
    });
    if (message?.chat?.id && message?.message_id) {
      await api.editMessageText({
        chat_id: message.chat.id,
        message_id: message.message_id,
        text,
        ...(markup ? { reply_markup: markup } : {}),
      });
    }
  } catch (error) {
    console.error('BIKA_SERVERLESS_CALLBACK_FAILED', {
      action: data,
      error: String(error?.message || error),
    });
    await api.answerCallbackQuery({
      callback_query_id: query.id,
      text: 'Preview action failed safely.',
      show_alert: true,
    });
  }
}
