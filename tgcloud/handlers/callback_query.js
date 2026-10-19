import { api } from 'sdk';
import { ensureUser } from '../lib/users.js';
import { createStarsInvoice, STAR_PACKAGES, packageBalance } from '../lib/stars.js';
import {
  crashCashout, minesOpen, minesCashout, blackjackAction, shanDeal,
} from '../lib/game.js';

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
