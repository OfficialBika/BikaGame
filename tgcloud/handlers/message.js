import { api } from 'sdk';
import { parseCommand } from '../lib/commandParser.js';
import { ensureUser, formatCoin, displayName, listTopUsers } from '../lib/users.js';
import { claimDailyReward } from '../lib/economy.js';
import { getFeatureStatus } from '../lib/featureStatus.js';
import { parseGameToggle, normalizeGameKey } from '../lib/gameControlNames.js';
import { createDiceChallenge, activateDiceChallenge, failDiceChallengeCreation } from '../lib/diceDuel.js';
import { setGameEnabled, assertGameEnabled, listGameStates } from '../lib/gameControls.js';
import { checkGroupAccess, approveCurrentGroup, rejectCurrentGroup, getGroupStatus, groupAccessMessage } from '../lib/groupApproval.js';
import { isGroupChat } from '../lib/groupApprovalPolicy.js';
import { parseBroadcastRequest } from '../lib/broadcastPolicy.js';
import { startBroadcast, resumeBroadcast, cancelBroadcast, getBroadcastStatus, assertBroadcastOwner } from '../lib/broadcast.js';
import { createStarsInvoice, creditSuccessfulStars, STAR_PACKAGES, packageBalance } from '../lib/stars.js';
import {
  playSlot, playPlinko, wheelSpin, crashStart, minesStart,
  blackjackJoin, shanCreate, shanJoin, history as getGameHistory,
} from '../lib/game.js';
import {
  reconcileTwoDOnUpdate, handleTwoDBet, settingsChannelIdForOwner,
  closeTwoDEvent, settleTwoDResult, getTwoDStatus, getMyTwoDBet,
} from '../lib/twoD.js';


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
    '/daily — daily claim (500–2,000 Bal by default; group only)',
    '/top10 — preview leaderboard',
    '/slot <bet> — slot preview',
    '/plinko <bet> — Plinko preview',
    '/wheel <bet> — lucky wheel preview',
    '/mines <bet> — Mines preview',
    '/crash <bet> — Rocket Crash preview',
    '/blackjack <bet> [room] — Blackjack preview',
    '/shan <bet> [room] — Shan Koe Mee preview',
    '/wallet — preview wallet ID and balance',
    '/2dchannel <channel_id> — Owner-only: configure the 2D posting channel (bot must be admin)',
    '/2dstatus, /mybet, /betclose, /2dwin <00–99> — 2D preview controls',
    '.2d 00.33.66 5000 — 2D bet by replying to the open post in its linked discussion',
    '/history — recent preview game history',
    '/features — preview and migration status by feature',
    '/play — open the Serverless test Mini App',
    '/serverlessstatus — migration status',
    '/gamestatus — per-game on/off status',
    '/slot on|off, /bj on|off, /shan on|off, /dice on|off, /mine on|off — Owner-only game controls',
    '/game on|off <game> — alternate Owner-only game control syntax',
    '/broadcast <text> — Owner-only text broadcast; reply with /broadcast -copy to copy media/buttons',
    '/broadcast -h — show broadcast usage; /broadcast resume|status|cancel — control saved jobs',
    '/broadcastend — stop the active broadcast',
    '',
    '⚠️ This is isolated preview currency; production MongoDB is never read or modified.',
    'The /transfer chat command stays disabled in this preview; Mini App transfers use the isolated atomic ledger and still require test-bot verification.',
  ].join('\n');
}

export default async function (message) {
  const chatId = message?.chat?.id;
  const from = message?.from;
  if (!chatId || (from?.is_bot && !message?.is_automatic_forward)) return;

  // Serverless has no persistent timer process. Reconcile scheduled 2D state on
  // inbound updates so overdue events close and an in-window session can open.
  try {
    if (message?.text || message?.is_automatic_forward) await reconcileTwoDOnUpdate(message);
  } catch (error) {
    console.warn('BIKA_2D_RECONCILE_FAILED', String(error?.message || error));
  }
  if (!from) return;

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
  const isTwoDBet = /^\\.2d(?:@\\w+)?(?:\\s|$)/i.test(String(message.text || '').trim());
  if (!command && !gameToggle && !isTwoDBet) return;

  let broadcastProgressMessage = null;
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

    if (isTwoDBet) {
      const result = await handleTwoDBet(message);
      return send(chatId, result.text, message.message_id);
    }

    if (command?.name === '2dchannel') {
      if (message.chat?.type !== 'private') {
        return send(chatId, '/2dchannel ကို Owner ရဲ့ private chat ထဲမှာပဲ သုံးပါ။', message.message_id);
      }
      const result = await settingsChannelIdForOwner(from.id, command.args);
      return send(chatId, '✅ 2D Channel configured\n' +
        'Channel: ' + result.title + '\n' +
        'Channel ID: ' + result.channelId + '\n' +
        'Schedule: Yangon 08:00–11:50 and 13:00–15:59, Monday–Friday.\n' +
        'Serverless opens/closes on inbound updates; exact-time external scheduler parity is still a deployment blocker.', message.message_id);
    }
    if (command?.name === '2dstatus') {
      const status = await getTwoDStatus();
      return send(chatId, '🎯 BIKA 2D Status\n' +
        'State: ' + status.status + '\n' +
        'Event: ' + (status.eventId || '—') + '\n' +
        'Closes: ' + (status.closeAt || '—') + '\n' +
        'Result: ' + (status.winningNumber || '—') + '\n' +
        'Channel configured: ' + (status.channelConfigured ? 'YES' : 'NO'), message.message_id);
    }
    if (command?.name === 'mybet') {
      const result = await getMyTwoDBet(from.id);
      if (!result.items.length) return send(chatId, '🎯 ဒီ 2D Event မှာ Bet မရှိသေးပါ။', message.message_id);
      return send(chatId, '🎯 BIKA 2D · ' + result.eventId + '\n' +
        result.items.map(row => row.number + ' — ' + formatCoin(row.amount) + ' Bal (win up to ' + formatCoin(row.potentialWin) + ')').join('\n') +
        '\nState: ' + result.status, message.message_id);
    }
    if (command?.name === 'betclose' || command?.name === '2dclose') {
      const result = await closeTwoDEvent(from.id);
      return send(chatId, result.ok ? '🔒 2D betting closed. Event: ' + result.eventId : 'ℹ️ Open 2D event မရှိပါ သို့မဟုတ် ပိတ်ပြီးသားပါ။', message.message_id);
    }
    if (command?.name === '2dwin') {
      const result = await settleTwoDResult(from.id, command.args);
      return send(chatId, (result.duplicate ? 'ℹ️ Result ကို အရင် settle လုပ်ပြီးသားပါ။' : '✅ 2D settlement complete.') +
        '\nEvent: ' + result.eventId + '\nResult: ' + result.number +
        '\nWinners: ' + Number(result.winnerCount || 0) +
        '\nTotal paid: ' + formatCoin(result.totalPaid || 0) + ' Bal', message.message_id);
    }

    if (command && ['broadcast', 'broadcastend'].includes(command.name)) {
      assertBroadcastOwner(from.id);
      if (command.name === 'broadcastend') {
        const stopped = await cancelBroadcast({ actorId: from.id });
        return send(chatId, stopped.ok
          ? (stopped.status === 'cancel_requested' ? '🛑 Broadcast cancellation requested.' : '🛑 Saved broadcast cancelled.')
          : 'ℹ️ No active or paused broadcast job.', message.message_id);
      }

      const request = parseBroadcastRequest(command.args, Boolean(message.reply_to_message));
      if (request.action === 'help') {
        return send(chatId,
          '📣 BIKA Broadcast (Serverless preview)\n\n' +
          '/broadcast <text> — send text to users and approved groups\n' +
          'Reply to a message with /broadcast or /broadcast -copy — copy media/caption/buttons\n' +
          '/broadcast resume — process the next saved batch\n' +
          '/broadcast status — inspect the latest running/paused job\n' +
          '/broadcast cancel or /broadcastend — stop the job\n\n' +
          'Rate cap: 25 sends/sec; batch cap: 100 recipients per invocation. Larger jobs are saved and resumed explicitly.',
          message.message_id);
      }
      if (request.action === 'invalid-copy') {
        return send(chatId, '⚠️ Copy mode အတွက် copy လုပ်လိုသော message ကို reply လုပ်ပြီး /broadcast -copy ပို့ပါ။', message.message_id);
      }
      if (request.action === 'cancel') {
        const stopped = await cancelBroadcast({ actorId: from.id });
        return send(chatId, stopped.ok
          ? (stopped.status === 'cancel_requested' ? '🛑 Broadcast cancellation requested.' : '🛑 Saved broadcast cancelled.')
          : 'ℹ️ No active or paused broadcast job.', message.message_id);
      }
      if (request.action === 'status') {
        const state = await getBroadcastStatus(from.id);
        if (state.status === 'idle') return send(chatId, 'ℹ️ No running or paused broadcast job.', message.message_id);
        return send(chatId, '📣 Broadcast Status\n' +
          'Job: ' + state.jobId + '\n' +
          'State: ' + state.status + '\n' +
          'Processed: ' + state.counters.processed + '/' + state.counters.total + '\n' +
          'Sent: ' + state.counters.sent + '\n' +
          'Skipped: ' + state.counters.skipped + '\n' +
          'Failed: ' + state.counters.failed + '\n' +
          'Pending: ' + state.counters.pending, message.message_id);
      }
      if (request.action === 'resume') {
        broadcastProgressMessage = await send(chatId, '⏳ Resuming saved broadcast batch…', message.message_id);
        return await resumeBroadcast({ actorId: from.id, ownerChatId: chatId, progressMessageId: broadcastProgressMessage?.message_id });
      }
      if (request.action === 'start') {
        broadcastProgressMessage = await send(chatId, '📣 Preparing broadcast snapshot…', message.message_id);
        return await startBroadcast({
          actorId: from.id,
          ownerChatId: chatId,
          text: request.text,
          mode: request.mode,
          sourceMessage: request.mode === 'copy' ? message.reply_to_message : null,
          progressMessageId: broadcastProgressMessage?.message_id,
        });
      }
      return send(chatId, '⚠️ Unsupported broadcast action.', message.message_id);
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
        '• Mini App wallet transfer: isolated atomic-ledger preview; runtime tests required',
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
        '⚠️ /transfer chat command ကို preview မှာ ပိတ်ထားဆဲပါ။ Mini App wallet transfer က isolated atomic ledger ကို သုံးပေမယ့် test bot မှာ replay/concurrency စမ်းသပ်မှု မပြီးမချင်း production အတွက် မဖွင့်ပါ။',
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
          'Mini App wallet transfer ကို isolated ledger နဲ့ စမ်းသပ်နေဆဲပါ။ /transfer chat command ကို ပိတ်ထားပြီး production transfer အဖြစ် မသုံးရသေးပါ။',
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
      if (!isGroupChat(message.chat)) {
        return send(chatId, 'ℹ️ /daily ကို group ထဲမှာပဲ အသုံးပြုနိုင်ပါတယ်။', message.message_id);
      }
      try {
        const result = await claimDailyReward(user.tgId);
        const note = result.duplicate ? '\n(ယနေ့ claim ကို အရင်က အောင်မြင်စွာ မှတ်တမ်းတင်ထားပြီးပါပြီ။)' : '';
        return send(
          chatId,
          '🎁 Daily Claim Success\n━━━━━━━━━━━━━━\n' +
            'Reward: +' + formatCoin(result.reward) + ' Bal\n' +
            'Balance: ' + formatCoin(result.balance) + ' Bal\n' +
            'Date: ' + result.dayKey + ' (Yangon)' + note,
          message.message_id,
        );
      } catch (error) {
        const code = String(error?.code || error?.message || error);
        if (code.includes('DAILY_ALREADY_CLAIMED')) {
          return send(chatId, '⏳ ဒီနေ့ claim လုပ်ပြီးပါပြီ။ Yangon time နဲ့ နောက်နေ့မှ ပြန်လုပ်ပါ။', message.message_id);
        }
        if (code.includes('TREASURY_INSUFFICIENT')) {
          return send(chatId, '🏦 Bot Bank balance မလုံလောက်လို့ daily claim မပေးနိုင်သေးပါ။', message.message_id);
        }
        return send(chatId, '⚠️ Daily claim မအောင်မြင်ပါ။ ခဏနေပြီး ပြန်စမ်းပါ။', message.message_id);
      }
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
      BROADCAST_RUNNING: 'Broadcast တစ်ခု အလုပ်လုပ်နေပါတယ်။ ပြီး/ရပ်သွားမှ ပြန်စပါ။',
      BROADCAST_NOT_RESUMABLE: 'ဆက်လုပ်နိုင်တဲ့ saved broadcast မတွေ့ပါ။ /broadcast status နဲ့စစ်ပါ။',
      BROADCAST_SOURCE_INVALID: 'Copy mode အတွက် message ကို reply လုပ်ပေးပါ။',
      BROADCAST_TEXT_TOO_LONG: 'Broadcast စာသားရှည်လွန်းပါတယ်။ ပိုတိုအောင်ပြင်ပါ။',
      BROADCAST_BATCH_FAILED: 'Broadcast batch ကို pause လုပ်ထားပါတယ်။ /broadcast resume နဲ့ဆက်နိုင်ပါတယ်။',
      INVALID_GAME: 'Game အမည် မမှန်ပါ။',
      TWO_D_CHANNEL_INVALID: 'Channel ID ကို -100... numeric ID ပုံစံဖြင့် ထည့်ပါ။',
      TWO_D_CHANNEL_UNAVAILABLE: 'Channel မတွေ့ပါ။ Bot ကို admin ပေးပြီး Channel ID ပြန်စစ်ပါ။',
      TWO_D_CHANNEL_REQUIRED: '2D အတွက် Telegram channel တစ်ခုကိုသာ သတ်မှတ်ပါ။',
      TWO_D_CHANNEL_BOT_ADMIN_REQUIRED: 'Bot ကို 2D channel မှာ administrator လုပ်ပေးပါ။',
      TWO_D_CHANNEL_NOT_CONFIGURED: 'Owner က private chat ထဲမှာ /2dchannel -100... ကို အရင်သတ်မှတ်ပါ။',
      TWO_D_GROUP_REQUIRED: '.2d ကို linked discussion group ထဲမှာပဲ သုံးနိုင်ပါတယ်။',
      TWO_D_AMOUNT_LIMIT: 'တစ်ဂဏန်းလျှင် 200 မှ 200,000 Bal အတွင်း ထိုးပါ။',
      TWO_D_NUMBER_INVALID: 'ဂဏန်းပုံစံမမှန်ပါ။ 00–99 သို့မဟုတ် 00R ပုံစံ သုံးပါ။',
      TWO_D_NUMBER_LIMIT: 'ဒီဂဏန်းအတွက် တစ်ဦးလျှင် စုစုပေါင်း 200,000 Bal ထက် မကျော်ရပါ။',
      TWO_D_CLOSED: '2D ထိုးကြေးပိတ်ထားပါပြီ။',
      TWO_D_BET_INVALID: '2D bet ပုံစံ မမှန်ပါ။',
      TWO_D_SESSION_CLOSED: 'Yangon time AM 08:00–11:50 / PM 13:00–15:59 (Mon–Fri) အတွင်းသာ ထိုးနိုင်ပါသည်။',
      TWO_D_EVENT_CLOSED: '2D Open post မဖွင့်ရသေးပါ။',
      TWO_D_REPLY_REQUIRED: 'သက်ဆိုင်ရာ 2D Open Post ၏ linked discussion comment ကို reply လုပ်ပါ။',
      TWO_D_FORMAT: 'ဥပမာ .2d 00.33.66 5000 သို့မဟုတ် .2d 45R 5000',
      TWO_D_RESULT_INVALID: 'ပေါက်ဂဏန်းကို 00–99 နှစ်လုံးပုံစံပေးပါ။',
      TWO_D_EVENT_NOT_CLOSED: 'ပိတ်ပြီးသား 2D Event မရှိပါ။ အရင် /betclose ပို့ပါ။',
      TWO_D_RESULT_CONFLICT: 'ဒီ Event ကို အခြား result ဖြင့် settle လုပ်ပြီးသားပါ။',
      TWO_D_SETTLEMENT_CONFLICT: 'Settlement အခြား process က လုပ်နေသည် သို့မဟုတ် result မတူပါ။',
      TWO_D_PAYOUT_OVERFLOW: 'စုစုပေါင်း payout က ledger limit ကျော်နေပါသည်။',
    };
    const errorCode = error?.code || error?.parameters?.code || error?.details?.code || error?.error?.code;
    const safeMessage = messageByCode[errorCode] || messageByCode[error?.message] || 'Preview command failed safely. No production data was changed.';
    if (broadcastProgressMessage?.message_id && command?.name === 'broadcast') {
      try {
        return await api.editMessageText({
          chat_id: chatId,
          message_id: broadcastProgressMessage.message_id,
          text: '⚠️ ' + safeMessage,
          reply_markup: { inline_keyboard: [] },
        });
      } catch (_) {}
    }
    return send(
      chatId,
      '⚠️ ' + safeMessage,
      message.message_id,
    );
  }
}
