import { api } from 'sdk';
import { ensureUser, formatCoin, displayName, listTopUsers } from '../lib/users.js';
import { getFeatureStatus } from '../lib/featureStatus.js';
import { createStarsInvoice, creditSuccessfulStars, STAR_PACKAGES, packageBalance } from '../lib/stars.js';
import {
  playSlot, playPlinko, wheelSpin, dailyWheel, crashStart, minesStart,
  blackjackJoin, shanCreate, shanJoin, history as getGameHistory,
} from '../lib/game.js';

function parseCommand(text) {
  const match = String(text || '').trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  return match ? { name: match[1].toLowerCase(), args: (match[2] || '').trim() } : null;
}

function args(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean);
}

async function send(chatId, text, replyToMessageId, replyMarkup) {
  const params = { chat_id: chatId, text };
  if (replyToMessageId) {
    params.reply_parameters = {
      message_id: Number(replyToMessageId),
      allow_sending_without_reply: true,
    };
  }
  if (replyMarkup) params.reply_markup = replyMarkup;
  return api.sendMessage(params);
}

const keyboard = (rows) => ({ inline_keyboard: rows });
const SERVERLESS_MINIAPP_URL = 'https://app8694856110.tgcloud.ai/';
const tileRow = (start, end) => Array.from({ length: end - start + 1 }, (_, offset) => {
  const index = start + offset;
  return { text: String(index + 1), callback_data: 'mines:open:' + index };
});
const minesKeyboard = () => keyboard([
  tileRow(0, 4),
  tileRow(5, 9),
  [{ text: '💰 CASH OUT', callback_data: 'mines:cashout' }],
]);

function helpText() {
  return [
    '🎮 BIKA Game — Serverless preview',
    '',
    '/start — initialize preview profile',
    '/help — commands',
    '/balance — preview balance',
    '/daily — preview daily reward',
    '/top10 — preview leaderboard',
    '/slot <bet> — slot preview',
    '/plinko <bet> — Plinko preview',
    '/wheel <bet> — lucky wheel preview',
    '/mines <bet> — Mines preview',
    '/crash <bet> — Rocket Crash preview',
    '/blackjack <bet> [room] — Blackjack preview',
    '/shan <bet> [room] — Shan Koe Mee preview',
    '/wallet — preview wallet ID and balance',
    '/history — recent preview game history',
    '/features — preview and migration status by feature',
    '/play — open the Serverless test Mini App',
    '/serverlessstatus — migration status',
    '',
    '⚠️ This is isolated preview currency; production MongoDB is never read or modified.',
    'Wallet transfers are disabled until an atomic transfer/ledger operation is implemented.',
  ].join('\n');
}

export default async function (message) {
  const chatId = message?.chat?.id;
  const from = message?.from;
  if (!chatId || !from || from.is_bot) return;

  const command = parseCommand(message.text);
  if (!command) return;

  try {
    if (command.name === 'help') return send(chatId, helpText(), message.message_id);
    if (command.name === 'serverlessstatus') {
      return send(chatId, [
        'BIKA Serverless preview status',
        '• Bot handler: available',
        '• Profile / wallet read: available',
        '• Games: isolated preview runtime',
        '• Mini App endpoints: preview only',
        '• Wallet transfer: disabled pending atomic settlement',
        '• Production MongoDB import: NOT RUN',
        '• Production cutover: NOT APPROVED',
      ].join('\n'), message.message_id);
    }
    if (command.name === 'features') {
      const status = getFeatureStatus();
      const lines = status.groups.map((group) =>
        group.label + ' [' + group.status + ']\n' + group.features.map((feature) => '  • ' + feature).join('\n')
      );
      return send(
        chatId,
        '🧭 BIKA Serverless Feature Status\n\n' + lines.join('\n\n') +
          '\n\n⚠️ Preview database only. Production cutover is not approved.',
        message.message_id,
      );
    }
    if (command.name === 'play' || command.name === 'app' || command.name === 'webapp') {
      if (message.chat?.type !== 'private') {
        return send(chatId, 'Open the Mini App from the bot private chat.', message.message_id);
      }
      return send(
        chatId,
        '🎮 BIKA Game Serverless Test Mini App\n\nThis is an isolated preview, not the production wallet or game backend.',
        message.message_id,
        keyboard([[{ text: '🚀 Open BIKA Game Preview', web_app: { url: SERVERLESS_MINIAPP_URL } }]]),
      );
    }
    if (command.name === 'transfer') {
      return send(
        chatId,
        '⚠️ Wallet transfer is temporarily disabled in this preview. It will remain disabled until sender balance, recipient balance and ledger writes can be committed atomically.',
        message.message_id,
      );
    }

    const user = await ensureUser(from);

    if (command.name === 'start') {
      return send(
        chatId,
        '👋 Welcome to BIKA Game Serverless preview, ' + displayName(user) + '!\n\n' +
          'Your isolated preview profile is ready.\n' +
          'Balance: ' + formatCoin(user.balance) + ' $\n\n' +
          '⚠️ No production balance, bonus or wager was imported.',
        message.message_id,
      );
    }
    if (command.name === 'balance' || command.name === 'mybalance') {
      return send(
        chatId,
        '💼 BIKA Preview Wallet\n' +
          'Player: ' + displayName(user) + '\n' +
          'Balance: ' + formatCoin(user.balance) + ' $\n' +
          'Wallet ID: ' + user.tgId + '\n\nPreview database only.',
        message.message_id,
      );
    }
    if (command.name === 'wallet') {
      return send(
        chatId,
        '💳 BIKA Preview Wallet\n' +
          'ID: ' + user.tgId + '\n' +
          'Balance: ' + formatCoin(user.balance) + ' $\n\n' +
          'Transfers are disabled in this preview until atomic transfer and ledger writes are available.',
        message.message_id,
      );
    }
    if (command.name === 'history' || command.name === 'myhistory') {
      const rows = await getGameHistory(user.tgId, 'all', 10);
      if (!rows.length) {
        return send(chatId, '📜 Preview History\n\nNo preview games recorded yet.', message.message_id);
      }
      const lines = rows.map((row) => {
        const betAmount = Number(row.bet || 0);
        const payout = Number(row.payout || 0);
        const net = payout - betAmount;
        const date = row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 16).replace('T', ' ') : '—';
        return '• ' + String(row.game || 'game').toUpperCase() +
          ' | Bet ' + formatCoin(betAmount) +
          ' | Payout ' + formatCoin(payout) +
          ' | Net ' + (net > 0 ? '+' : '') + formatCoin(net) +
          ' | ' + date;
      });
      return send(chatId, '📜 Last 10 Preview Results\n\n' + lines.join('\n'), message.message_id);
    }
    if (command.name === 'top10' || command.name === 'leaderboard') {
      const ranking = await listTopUsers(10);
      const lines = ranking.length
        ? ranking.map((player, index) => (index + 1) + '. ' + displayName(player) + ' — ' + formatCoin(player.balance) + ' $').join('\n')
        : 'No preview players yet.';
      return send(chatId, '🏆 BIKA Preview Top 10\n\n' + lines, message.message_id);
    }
    if (command.name === 'daily') {
      const result = await dailyWheel(user.tgId);
      return send(
        chatId,
        '🎁 Daily preview reward: +' + formatCoin(result.reward) + ' $\n' +
          'Balance: ' + formatCoin(result.balance) + ' $',
        message.message_id,
      );
    }

    const parsedArgs = args(command.args);
    const bet = parsedArgs[0];

    if (command.name === 'slot') {
      const result = await playSlot(user.tgId, bet);
      return send(
        chatId,
        '🎰 SLOT\n\n' + result.reels.join(' | ') +
          '\nMultiplier: x' + result.multiplier +
          '\nPayout: ' + formatCoin(result.payout) + ' $' +
          '\nBalance: ' + formatCoin(result.balance) + ' $',
        message.message_id,
      );
    }
    if (command.name === 'plinko') {
      const result = await playPlinko(user.tgId, bet);
      return send(
        chatId,
        '🟡 PLINKO\nMultiplier: x' + result.multiplier +
          '\nPayout: ' + formatCoin(result.payout) + ' $' +
          '\nBalance: ' + formatCoin(result.balance) + ' $',
        message.message_id,
      );
    }
    if (command.name === 'wheel') {
      const result = await wheelSpin(user.tgId, bet);
      return send(
        chatId,
        '🎡 LUCKY WHEEL\nReward: ' + result.reward + '%' +
          '\nPayout: ' + formatCoin(result.payout) + ' $' +
          '\nBalance: ' + formatCoin(result.balance) + ' $',
        message.message_id,
      );
    }
    if (command.name === 'crash') {
      const result = await crashStart(user.tgId, bet);
      return send(
        chatId,
        '🚀 ROCKET CRASH\nRound started.\nCurrent: x1.00\n\nPress Cash Out before the rocket crashes.',
        message.message_id,
        keyboard([[{ text: '💰 CASH OUT', callback_data: 'crash:cashout:' + result.sessionId }]]),
      );
    }
    if (command.name === 'mines') {
      await minesStart(user.tgId, bet);
      return send(
        chatId,
        '💣 MINES\nRound started. Multiplier x1.00\nChoose a tile.',
        message.message_id,
        minesKeyboard(),
      );
    }
    if (command.name === 'blackjack') {
      const room = parsedArgs[1] || 'solo';
      const result = await blackjackJoin(user.tgId, room, bet);
      const cards = (result.player?.cards || []).map((card) => card.r + card.s).join(' ');
      return send(
        chatId,
        '🂡 BLACKJACK\nRoom: ' + room + '\nYour cards: ' + cards,
        message.message_id,
        keyboard([[
          { text: 'HIT', callback_data: 'bj:hit:' + room },
          { text: 'STAND', callback_data: 'bj:stand:' + room },
        ]]),
      );
    }
    if (command.name === 'shan') {
      const room = parsedArgs[1];
      if (room) {
        const result = await shanJoin(user.tgId, room, bet);
        return send(
          chatId,
          '🎴 SHAN KOE MEE\nRoom: ' + room + '\nPlayers: ' + (result.players?.length || 0),
          message.message_id,
        );
      }
      const result = await shanCreate(user.tgId);
      return send(
        chatId,
        '🎴 Shan table created\nRoom ID: ' + result.roomId + '\nJoin with /shan <bet> ' + result.roomId,
        message.message_id,
      );
    }

    return send(
      chatId,
      'This command is not ported to Serverless preview yet. No production data was changed.',
      message.message_id,
    );
  } catch (error) {
    console.error('BIKA_SERVERLESS_MESSAGE_HANDLER_FAILED', {
      command: command.name,
      error: String(error?.message || error),
    });
    const messageByCode = {
      USER_INSUFFICIENT: 'Balance မလုံလောက်ပါ။',
      INVALID_BET: 'Bet amount ကို 1 မှ 1,000,000 အတွင်း ကိန်းပြည့်ထည့်ပါ။',
      WHEEL_DAILY_USED: 'Daily reward ကို ဒီနေ့ claim လုပ်ပြီးသားပါ။',
      CRASH_RUNNING: 'Crash round လက်ရှိ run နေပါတယ်။',
      MINES_ACTIVE: 'Mines round လက်ရှိ run နေပါတယ်။',
      NO_ACTIVE_CRASH: 'Active Crash round မရှိပါ။',
      NO_ACTIVE_MINES: 'Active Mines round မရှိပါ။',
      MINES_CASHOUT_LOCKED: 'Safe tile အနည်းဆုံး ၁ ခု ဖွင့်ပြီးမှ cash out လုပ်ပါ။',
      BJ_TABLE_FULL: 'Blackjack table ပြည့်နေပါပြီ။',
      SHAN_TABLE_FULL: 'Shan table ပြည့်နေပါပြီ။',
    };
    return send(
      chatId,
      '⚠️ ' + (messageByCode[error?.message] || 'Preview command failed safely. No production data was changed.'),
      message.message_id,
    );
  }
}
