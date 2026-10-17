import { api } from 'sdk';
import { ensureUser } from '../lib/users.js';
import { EndpointError } from 'sdk';

const ATOMIC_SETTLEMENT_DISABLED = new EndpointError(
  'Game actions are disabled until atomic balance and ledger settlement is verified.',
  { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' },
);

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

    if (game === 'crash' || game === 'mines' || game === 'bj' || game === 'shan') {
      throw ATOMIC_SETTLEMENT_DISABLED;
    } else {
      text = 'Unsupported action.';
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
