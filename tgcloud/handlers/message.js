import { api } from 'sdk';
import { parseCommand } from '../lib/commandParser.js';
import { ensureUser, formatCoin, displayName, listTopUsers } from '../lib/users.js';
import { getFeatureStatus } from '../lib/featureStatus.js';
import { parseGameToggle, normalizeGameKey } from '../lib/gameControlNames.js';
import { createDiceChallenge, activateDiceChallenge, failDiceChallengeCreation } from '../lib/diceDuel.js';
import { setGameEnabled, assertGameEnabled, listGameStates } from '../lib/gameControls.js';
import { checkGroupAccess, approveCurrentGroup, rejectCurrentGroup, getGroupStatus, groupAccessMessage } from '../lib/groupApproval.js';
import { isGroupChat } from '../lib/groupApprovalPolicy.js';
import { createStarsInvoice, creditSuccessfulStars, STAR_PACKAGES, packageBalance } from '../lib/stars.js';
import {
  playSlot, playPlinko, wheelSpin, dailyWheel, crashStart, minesStart,
  blackjackJoin, shanCreate, shanJoin, history as getGameHistory,
} from '../lib/game.js';


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
    '/gamestatus — per-game on/off status',
    '/slot on|off, /bj on|off, /shan on|off, /dice on|off, /mine on|off — Owner-only game controls',
    '/game on|off <game> — alternate Owner-only game control syntax',
    '',
    '⚠️ This is isolated preview currency; production MongoDB is never read or modified.',
    'Wallet transfers are disabled until an atomic transfer/ledger operation is implemented.',
  ].join('\n');
}

export default async function (message) {
  const chatId = message?.chat?.id;
  const from = message?.from;
  if (!chatId || !from || from.is_bot) return;

  // Only a successful_payment update can credit a Stars purchase.
  if (message?.successful_payment) {
    const result = await creditSuccessfulStars(message);
    const duplicateNote = result.duplicate ? ' (already processed; no duplicate credit)' : '';
    return send(
      chatId,
      '✅ Telegram Stars payment confirmed' + duplicateNote +
        '\nStars: ' + result.stars +
        '\nAdded: ' + formatCoin(result.balanceAmount) + ' Bal' +
        '\nBalance: ' + formatCoin(result.balance) + ' Bal',
      message.message_id,
    );
  }

  const gameToggle = parseGameToggle(message.text);
  const command = parseCommand(message.text);
  if (!command && !gameToggle) return;

  try {
    // Keep approval commands reachable for recovery; gate all other group commands.
    if (command && ['approve', 'reject', 'groupstatus'].includes(command.name)) {
      if (!isGroupChat(message.chat)) {
        return send(chatId, 'ဒီ command ကို group ထဲမှာပဲ သုံးပါ။', message.message_id);
      }
      if (command.name === 'approve') {
        const group = await approveCurrentGroup(message.chat, from.id);
        return send(chatId, '✅ Group Approved\n' +
          'Group: ' + String(group?.title || message.chat.title || 'Untitled Group') + '\n' +
          'Group ID: ' + chatId + '\nBot Admin: YES\nApproved by Owner: ' + from.id,
          message.message_id);
      }
      if (command.name === 'reject') {
        const group = await rejectCurrentGroup(message.chat, from.id);
        return send(chatId, '❌ Group Rejected\n' +
          'Group: ' + String(group?.title || message.chat.title || 'Untitled Group') + '\n' +
          'Group ID: ' + chatId + '\nRejected by Owner: ' + from.id,
          message.message_id);
      }
      const status = await getGroupStatus(message.chat);
      const group = status.group;
      return send(chatId, '👥 Group Status\n' +
        'Group: ' + String(group?.title || message.chat.title || 'Untitled Group') + '\n' +
        'Group ID: ' + chatId + '\n' +
        'Owner Approval: ' + String(group?.approvalStatus || 'pending').toUpperCase() + '\n' +
        'Bot Admin: ' + (status.botAdminCheckSucceeded ? (status.botIsAdmin ? 'YES' : 'NO') : 'UNVERIFIED') + '\n' +
        'Owner Configured: ' + (status.ownerConfigured ? 'YES' : 'NO'), message.message_id);
    }

    if (isGroupChat(message.chat)) {
      const access = await checkGroupAccess(message.chat, from.id);
      if (!access.allowed) return send(chatId, groupAccessMessage(access.reason), message.message_id);
    }

    if (gameToggle) {
      const state = await setGameEnabled(gameToggle.game, gameToggle.enabled, from.id);
      const label = state.game === 'blackjack' ? 'Blackjack' : state.game === 'mines' ? 'Mines' : state.game.toUpperCase();
      return send(chatId, (state.enabled ? '✅ ' : '⛔ ') + label + ' ' + (state.enabled ? 'ENABLED' : 'DISABLED') + '\n' + 'Changed by Owner · persisted setting saved.', message.message_id);
    }
    if (command.name === 'gamestatus') {
      const states = await listGameStates();
      const lines = states.map((item) => (item.enabled ? '✅ ON  ' : '⛔ OFF ') + item.game.toUpperCase());
      return send(chatId, '🎮 Per-game controls (preview DB)\n' + lines.join('\n'), message.message_id);
    }
    if (command.name === 'stars' || command.name === 'buy') {
      if (message.chat?.type !== 'private') {
        return send(chatId, 'Telegram Stars invoice ကို bot private chat ထဲမှာပဲ ဖွင့်နိုင်ပါတယ်။', message.message_id);
      }
      const requestedStars = Number(command.args);
      if (STAR_PACKAGES.includes(requestedStars)) return createStarsInvoice(from.id, requestedStars);
      const rows = [];
      for (let i = 0; i < STAR_PACKAGES.length; i += 2) {
        rows.push(STAR_PACKAGES.slice(i, i + 2).map((stars) => ({
          text: '⭐ ' + stars + ' Stars · ' + formatCoin(packageBalance(stars)) + ' Bal',
          callback_data: 'stars:buy:' + stars,
        })));
      }
      return send(chatId, 'BIKA Stars → Bal\nRate: 1 Star = 45,000 Bal\nPackage တစ်ခုရွေးပါ။ Payment အောင်မြင်ပြီးမှ Bal ထည့်ပေးပါမယ်။', message.message_id, keyboard(rows));
    }

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
        '🎁 Daily reward: +' + formatCoin(result.payout ?? result.reward ?? 0) + ' Bal\n' +
          'Balance: ' + formatCoin(result.balance) + ' Bal',
        message.message_id,
      );
    }

    const parsedArgs = args(command.args);
    const bet = parsedArgs[0];

    if (command.name === 'slot') {
      await assertGameEnabled('slot');
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
    if (command.name === 'dice') {
      await assertGameEnabled('dice');
      if (!['group', 'supergroup'].includes(message.chat?.type)) {
        return send(chatId, 'ℹ️ Dice Duel ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။', message.message_id);
      }
      const target = message.reply_to_message?.from;
      if (!target?.id || target.is_bot || Number(target.id) === Number(from.id)) {
        return send(chatId, '⚠️ Challenge လုပ်မယ့် user ရဲ့ message ကို reply လုပ်ပြီး .dice <bet> သုံးပါ။', message.message_id);
      }

      let challenge;
      try {
        challenge = await createDiceChallenge({
          challenger: from,
          target,
          chatId,
          bet,
        });
        const winPayout = Math.floor(challenge.bet * 2 * 0.98);
        const sent = await send(
          chatId,
          '🎲 DICE DUEL CHALLENGE\n━━━━━━━━━━━━\n' +
            'Challenger: ' + (from.first_name || from.username || 'Player') + '\n' +
            'Target: ' + (target.first_name || target.username || 'Player') + '\n' +
            'Bet per player: ' + formatCoin(challenge.bet) + ' Bal\n' +
            'Winner receives: ' + formatCoin(winPayout) + ' Bal (2% house cut)\n' +
            '⏱ Accept within 60 seconds.',
          message.message_id,
          keyboard([
            [{ text: '✅ Accept Dice Duel', callback_data: 'dice:accept:' + challenge.sessionId }],
            [{ text: '❌ Cancel', callback_data: 'dice:cancel:' + challenge.sessionId }],
          ]),
        );
        const sentMessageId = Number(sent?.message_id ?? sent?.result?.message_id);
        if (!Number.isSafeInteger(sentMessageId) || sentMessageId <= 0) {
          throw new Error('DICE_CHALLENGE_MESSAGE_ID_MISSING');
        }
        await activateDiceChallenge(challenge.sessionId, sentMessageId);
        return sent;
      } catch (error) {
        if (challenge?.sessionId) {
          try { await failDiceChallengeCreation(challenge.sessionId); } catch (_) {}
        }
        throw error;
      }
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
    if (command.name === 'mines' || command.name === 'mine') {
      await assertGameEnabled('mines');
      await minesStart(user.tgId, bet);
      return send(
        chatId,
        '💣 MINES\nRound started. Multiplier x1.00\nChoose a tile.',
        message.message_id,
        minesKeyboard(),
      );
    }
    if (command.name === 'blackjack' || command.name === 'bj') {
      await assertGameEnabled('blackjack');
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
      await assertGameEnabled('shan');
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
      command: command?.name || 'game-toggle',
      error: String(error?.message || error),
    });
    const messageByCode = {
      USER_INSUFFICIENT: 'Balance မလုံလောက်ပါ။',
      DICE_BUSY: 'Dice challenge များနေပါတယ်။ ခဏနေပြီး ပြန်ကြိုးစားပါ။',
      DICE_GROUP_REQUIRED: 'Dice Duel ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။',
      DICE_INVALID_TARGET: 'အခြား human user တစ်ယောက်ကို challenge လုပ်ပါ။',
      DICE_TARGET_ONLY: 'ဒီ duel ကို reply ထောက်ထားတဲ့သူပဲ Accept လုပ်နိုင်ပါတယ်။',
      DICE_CANCEL_OWNER_ONLY: 'Challenge ဖန်တီးသူသာ Cancel လုပ်နိုင်ပါတယ်။',
      DICE_NOT_READY: 'Dice challenge ကို မပြင်ဆင်နိုင်သေးပါ။ ပြန်ကြိုးစားပါ။',
      DICE_INVALID_BET: 'Dice bet ကို 10 မှ 99,990,000 Bal အတွင်း ကိန်းပြည့်ထည့်ပါ။',
      SCHEMA_MIGRATION_BUSY: 'Preview database migration မပြီးသေးပါ။ ငွေစာရင်းမပြောင်းထားပါ၊ migration ပြီးမှ ပြန်စမ်းပါ။',
      INVALID_BET: 'Bet amount ကို 1 မှ 1,000,000 အတွင်း ကိန်းပြည့်ထည့်ပါ။',
      WHEEL_DAILY_USED: 'Daily reward ကို ဒီနေ့ claim လုပ်ပြီးသားပါ။',
      CRASH_RUNNING: 'Crash round လက်ရှိ run နေပါတယ်။',
      MINES_ACTIVE: 'Mines round လက်ရှိ run နေပါတယ်။',
      NO_ACTIVE_CRASH: 'Active Crash round မရှိပါ။',
      NO_ACTIVE_MINES: 'Active Mines round မရှိပါ။',
      MINES_CASHOUT_LOCKED: 'Safe tile အနည်းဆုံး ၁ ခု ဖွင့်ပြီးမှ cash out လုပ်ပါ။',
      BJ_TABLE_FULL: 'Blackjack table ပြည့်နေပါပြီ။',
      SHAN_TABLE_FULL: 'Shan table ပြည့်နေပါပြီ။',
      GAME_DISABLED: 'ဒီဂိမ်းကို Owner က ယာယီပိတ်ထားပါတယ်။',
      OWNER_ONLY: 'ဒီ command ကို Owner သာ သုံးနိုင်ပါတယ်။',
      OWNER_NOT_CONFIGURED: 'SERVERLESS_OWNER_TELEGRAM_ID ကို config မှာ သတ်မှတ်ပေးပါ။',
      BOT_ADMIN_REQUIRED: 'Bot ကို group admin ပေးပြီး API ကနေ အတည်ပြုနိုင်မှ /approve အောင်မြင်ပါမယ်။',
      GROUP_ONLY: 'ဒီ command ကို group ထဲမှာပဲ သုံးပါ။',
      GROUP_ID_INVALID: 'Group ID မမှန်ပါ။',
      INVALID_GAME: 'Game အမည် မမှန်ပါ။',
    };
    const errorCode = error?.code || error?.parameters?.code || error?.details?.code || error?.error?.code;
    return send(
      chatId,
      '⚠️ ' + (messageByCode[errorCode] || messageByCode[error?.message] || 'Preview command failed safely. No production data was changed.'),
      message.message_id,
    );
  }
}
