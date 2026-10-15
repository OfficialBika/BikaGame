import { api } from 'sdk';
import { ensureUser, formatCoin, displayName, listTopUsers } from '../lib/users.js';

function parseCommand(text) {
  const match = String(text || '').trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] || '').trim() };
}

async function send(chatId, text, replyToMessageId) {
  const params = { chat_id: chatId, text };
  if (Number.isSafeInteger(Number(replyToMessageId)) && Number(replyToMessageId) > 0) {
    params.reply_parameters = { message_id: Number(replyToMessageId), allow_sending_without_reply: true };
  }
  return api.sendMessage(params);
}

function helpText() {
  return [
    '🎮 BIKA Game — Serverless migration preview',
    '',
    '/start — initialize your preview profile',
    '/help — show supported preview commands',
    '/balance — read your preview balance',
    '/top10 — preview leaderboard',
    '/serverlessstatus — migration readiness',
    '',
    'This preview database is isolated from production MongoDB.',
    'Game rounds, rewards, transfers, purchases and bets are not enabled here yet.',
  ].join('\n');
}

export default async function (message) {
  const chatId = message?.chat?.id;
  const from = message?.from;
  if (!chatId || !from || from.is_bot) return;

  const command = parseCommand(message.text);
  if (!command) return;

  try {
    if (command.name === 'start') {
      const user = await ensureUser(from);
      await send(
        chatId,
        '👋 Welcome to BIKA Game Serverless preview, ' + displayName(user) + '!\n\n' +
        'Your isolated preview profile is ready. Preview balance: ' + formatCoin(user.balance) + ' $\n\n' +
        '⚠️ Production balances and history have not been imported. No bonus or wager was issued.\n' +
        'Use /help to see the preview commands.',
        message.message_id,
      );
      return;
    }

    if (command.name === 'help') {
      await send(chatId, helpText(), message.message_id);
      return;
    }

    if (command.name === 'serverlessstatus') {
      await send(
        chatId,
        'BIKA Serverless preview status\n' +
        '• Profile / balance read: available\n' +
        '• Leaderboard read: available\n' +
        '• Existing MongoDB data import: NOT RUN\n' +
        '• Rewards / transfers / betting: disabled\n' +
        '• Existing Mini App hosting: not enabled\n' +
        '• Production cutover: NOT APPROVED',
        message.message_id,
      );
      return;
    }

    const user = await ensureUser(from);

    if (command.name === 'balance' || command.name === 'mybalance') {
      await send(
        chatId,
        '💼 BIKA Preview Wallet\n' +
        'Player: ' + displayName(user) + '\n' +
        'Balance: ' + formatCoin(user.balance) + ' $\n\n' +
        'This is the isolated Serverless preview balance, not your production MongoDB balance.',
        message.message_id,
      );
      return;
    }

    if (command.name === 'top10') {
      const ranking = await listTopUsers(10);
      if (!ranking.length) {
        await send(chatId, '🏆 No preview players yet. Send /start first.', message.message_id);
        return;
      }
      const lines = ranking.map((player, index) =>
        String(index + 1) + '. ' + displayName(player) + ' — ' + formatCoin(player.balance) + ' $'
      );
      await send(chatId, '🏆 BIKA Preview Top 10\n\n' + lines.join('\n'), message.message_id);
      return;
    }

    // Deliberately do not execute unported economy or game commands.
    if (['daily', 'dailyclaim', 'gift', 'shop', 'wallet', 'sell', 'slot', 'mines', 'crash', 'dice', 'shan', 'blackjack', 'twod', 'sports'].includes(command.name)) {
      await send(
        chatId,
        'This game/economy command is not ported to the Serverless preview yet. No balance change was made.',
        message.message_id,
      );
    }
  } catch (error) {
    console.error('BIKA_SERVERLESS_MESSAGE_HANDLER_FAILED', {
      command: command.name,
      error: String(error?.message || error),
    });
    // Avoid returning database or platform internals to users.
    await send(chatId, '⚠️ The preview command failed safely. No production data was changed.', message.message_id);
  }
}
