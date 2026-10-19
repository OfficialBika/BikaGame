import { api } from 'sdk';
import { parseCommand } from '../lib/commandParser.js';
import { ensureUser, formatCoin, displayName, listTopUsers } from '../lib/users.js';
import { claimDailyReward, getSetting, setSetting, transferByWalletId, recordLedgerOperation, getTreasury } from '../lib/economy.js';
import { getFeatureStatus } from '../lib/featureStatus.js';
import { getMaintenanceMode, setMaintenanceMode, isConfiguredOwner, maintenanceCommandAction } from '../lib/maintenance.js';
import { ownerAdjustBalance, setLegacySlotWinRate, getLegacySlotWinRate, setVipWinRate, setTotalSupply, getTreasuryDashboard } from '../lib/adminEconomy.js';
import { parseGameToggle, normalizeGameKey } from '../lib/gameControlNames.js';
import { createDiceChallenge, activateDiceChallenge, failDiceChallengeCreation } from '../lib/diceDuel.js';
import { setGameEnabled, assertGameEnabled, listGameStates } from '../lib/gameControls.js';
import { checkGroupAccess, approveCurrentGroup, rejectCurrentGroup, getGroupStatus, groupAccessMessage } from '../lib/groupApproval.js';
import { isGroupChat } from '../lib/groupApprovalPolicy.js';
import { parseBroadcastRequest } from '../lib/broadcastPolicy.js';
import {
  parseSetEventText, createSportsEvent, findSportsEventForReply, rememberSportsThreadMessage,
  placeSportsBet, stopSportsEvent, settleSportsEvent, createAuction, findAuctionForReply,
  placeAuctionBid, finalizeAuction, cancelAuction, showAuctionStatus, reconcileEventMarketsOnUpdate,
  startPromoRtp, getWebGameRtp, getAllWebGameRtps, setWebGameRtp, recordDailyTournament,
  getDailyTournament, setShopEnabled, getShopEnabled,
} from '../lib/eventMarkets.js';
import {
  addShopCard, listAvailableShopCards, getShopCard, createShopOrder,
  listUserInventory, listUserShopOrders, listPendingShopOrders,
  createSellOrder, setSellPrice, getSellPrice, listSellOrders,
} from '../lib/commerce.js';
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
    '/daily, /dailyclaim, .daily — daily claim (500–2,000 Bal by default; group only)',
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
    '/off — turn Maintenance Mode ON (legacy main-branch command)',
    '/on — turn Maintenance Mode OFF (legacy main-branch command)',
    '/maintenance on|off|status — explicit Owner-only maintenance control',
    '/gamestatus — per-game on/off status',
    '/slot on|off, /bj on|off, /shan on|off, /dice on|off, /mine on|off — Owner-only game controls',
    '/game on|off <game> — alternate Owner-only game control syntax',
    '/broadcast <text> — Owner-only text broadcast; reply with /broadcast -copy to copy media/buttons',
    '/broadcast -h — show broadcast usage; /broadcast resume|status|cancel — control saved jobs',
    '/broadcastend — stop the active broadcast',
    '/setevent Team A vs Team B + odds + aliases — Owner sports event (reply to linked channel post)',
    '.bet alias amount — sports bet by replying to the event thread',
    '.stopbet / .betwin alias — Owner sports settlement controls',
    '/auctionchannel <channel_id>, /auction <start> <increment> <minutes> <title>',
    '.bid <amount> or reply with a bid amount — auction bidding',
    '/auctionstatus [id], /auctionfinish <id>, /auctioncancel <id> — Owner auction controls',
    '/dailytournament — today’s group Mines ranking',
    '/promortp <percent> <duration>, /setwebrtp <game> <percent>, /webrtp [game]',
    '/setrtp <percent> — legacy Slot win rate; /treasury /addbal /rmbal /setvipwr /vipwr',
    '/shop /inventory /sell — commerce preview controls',
    '',
    '⚠️ This is isolated preview currency; production MongoDB is never read or modified.',
    'Wallet transfers use the isolated ledger in this preview; test-bot verification remains required.',
  ].join('\n');
}

export default async function (message) {
  const chatId = message?.chat?.id;
  const from = message?.from;
  if (!chatId || (from?.is_bot && !message?.is_automatic_forward)) return;

  // Serverless has no persistent timer process. Reconcile scheduled 2D state on
  // inbound updates so overdue events close and an in-window session can open.
  try {
    if (message?.text || message?.is_automatic_forward) {
      await reconcileTwoDOnUpdate(message);
      await reconcileEventMarketsOnUpdate();
    }
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
  const isAuctionPlainBid = Boolean(message.reply_to_message &&
    /^\\d[\\d,]*$/.test(String(message.text || '').trim()));
  if (!command && !gameToggle && !isTwoDBet && !isAuctionPlainBid) return;

  let broadcastProgressMessage = null;
  try {
    // Preserve main-branch command semantics: /off enables maintenance, /on disables it.
    const legacyMaintenance = maintenanceCommandAction(command?.name);
    const maintenanceVerb = command?.name === 'maintenance'
      ? String(command.args || '').trim().toLowerCase()
      : legacyMaintenance?.action;
    if (command?.name === 'maintenance' || legacyMaintenance) {
      if (!isConfiguredOwner(from.id)) {
        return send(chatId, '⛔ Owner only. SERVERLESS_OWNER_TELEGRAM_ID ကို မှန်ကန်စွာ သတ်မှတ်ထားရပါမယ်။', message.message_id);
      }
      if (maintenanceVerb === 'status') {
        const state = await getMaintenanceMode();
        return send(chatId, '🛠️ Maintenance Mode: ' + (state.enabled ? 'ON' : 'OFF') +
          '\\nUpdated: ' + (state.updatedAt || '—') +
          '\\nUpdated by: ' + (state.updatedBy || '—'), message.message_id);
      }
      if (!['on', 'off'].includes(maintenanceVerb)) {
        return send(chatId, 'အသုံးပြုပုံ: /maintenance on|off|status\\nMain-compatible: /off = Maintenance ON, /on = Maintenance OFF', message.message_id);
      }
      const state = await setMaintenanceMode(from.id, maintenanceVerb === 'on');
      const legacyHint = legacyMaintenance
        ? (maintenanceVerb === 'on' ? ' (/off command)' : ' (/on command)')
        : '';
      return send(chatId, (state.enabled
        ? '🛠️ Bot Maintenance Mode ON'
        : '✅ Bot Online — Maintenance Mode OFF') + legacyHint, message.message_id);
    }

    // Maintenance gates every command-like action for non-owners. Payment updates
    // are handled above first so successful purchases are never lost during maintenance.
    const maintenance = await getMaintenanceMode();
    if (maintenance.enabled && !isConfiguredOwner(from.id)) {
      return send(chatId,
        '🛠️ Bot Maintenance Mode\\n━━━━━━━━━━━━\\nလက်ရှိ Bot ကို ပြုပြင်နေပါတယ်။\\nOwner သာ အသုံးပြုနိုင်ပါတယ်။\\nခဏစောင့်ပြီး ပြန်သုံးပေးပါ။',
        message.message_id);
    }

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

    const adminValues = args(command?.args);
    if (command?.name === 'promortp') {
      if (!isGroupChat(message.chat)) return send(chatId, '/promortp ကို group ထဲမှာပဲ သုံးပါ။', message.message_id);
      const promo = await startPromoRtp({ actorId: from.id, chatId, chatTitle: message.chat.title || message.chat.username || String(chatId), rtpInput: adminValues[0], durationText: adminValues[1] });
      const notice = await send(chatId, '🎰 Promotion Time Start\\nPromo RTP: ' + promo.rtp + '%\\nPromo Time: ' + promo.durationText +
        '\\nPromo Group: ' + (promo.groupName || chatId) + '\\nExpiry: ' + new Date(promo.expiresAt).toISOString(), message.message_id);
      const noticeId = Number(notice?.message_id ?? notice?.result?.message_id);
      if (noticeId > 0) { try { await api.pinChatMessage({ chat_id: chatId, message_id: noticeId, disable_notification: false }); } catch (_) {} }
      return notice;
    }
    if (command?.name === 'setwebrtp') {
      if (adminValues.length < 2) return send(chatId, 'Usage: /setwebrtp <rocket|slot|plinko|wheel|mines|blackjack|shan> <40–95>', message.message_id);
      const result = await setWebGameRtp(from.id, adminValues[0], adminValues[1]);
      return send(chatId, '✅ ' + result.label + ' RTP updated: ' + result.rtp + '%', message.message_id);
    }
    if (command?.name === 'webrtp') {
      if (adminValues[0]) {
        const rtp = await getWebGameRtp(adminValues[0]);
        return send(chatId, '🎮 ' + adminValues[0].toUpperCase() + ' Web RTP: ' + rtp + '%', message.message_id);
      }
      const values = await getAllWebGameRtps();
      return send(chatId, '🎮 Web Game RTP Dashboard\\n' +
        Object.entries(values).map(([game, rtp]) => game.toUpperCase() + ': ' + rtp + '%').join('\\n') +
        '\\nChange with /setwebrtp <game> <percent>', message.message_id);
    }
    if (command?.name === 'setrtp') {
      if (adminValues.length >= 2) {
        const result = await setWebGameRtp(from.id, adminValues[0], adminValues[1]);
        return send(chatId, '✅ ' + result.label + ' RTP updated: ' + result.rtp + '%', message.message_id);
      }
      if (!adminValues[0]) return send(chatId, 'Usage: /setrtp <0–100> (legacy Slot) or /setrtp <game> <40–95>', message.message_id);
      const rtp = await setLegacySlotWinRate(from.id, adminValues[0]);
      return send(chatId, '✅ Legacy Slot win rate updated: ' + rtp + '%', message.message_id);
    }
    if (command?.name === 'rtp') {
      if (adminValues[0]) {
        try {
          const rtp = await getWebGameRtp(adminValues[0]);
          return send(chatId, '🎮 ' + adminValues[0].toUpperCase() + ' Web RTP: ' + rtp + '%', message.message_id);
        } catch (_) {}
      }
      const rtp = await getLegacySlotWinRate();
      return send(chatId, '🎰 Legacy Slot win rate: ' + rtp + '%\\nWeb games: /webrtp', message.message_id);
    }
    if (command?.name === 'setvipwr') {
      if (!adminValues[0]) return send(chatId, 'Usage: /setvipwr <0–100>', message.message_id);
      const rate = await setVipWinRate(from.id, adminValues[0]);
      return send(chatId, '✅ VIP Win Rate updated: ' + rate + '%', message.message_id);
    }
    if (command?.name === 'vipwr') {
      const dashboard = await getTreasuryDashboard(from.id);
      return send(chatId, '📊 VIP Win Rate: ' + dashboard.vipWinRate + '%', message.message_id);
    }
    if (command?.name === 'settotal') {
      if (!adminValues[0]) return send(chatId, 'Usage: /settotal <amount>', message.message_id);
      const total = await setTotalSupply(from.id, adminValues[0]);
      const dashboard = await getTreasuryDashboard(from.id);
      return send(chatId, '✅ Preview Treasury Initialized\\nTotal Supply: ' + formatCoin(total) +
        ' Bal\\nBot Bank: ' + formatCoin(dashboard.ownerBalance) + ' Bal', message.message_id);
    }
    if (command?.name === 'treasury') {
      const d = await getTreasuryDashboard(from.id);
      const web = await getAllWebGameRtps();
      return send(chatId, '🏦 Treasury Dashboard (isolated preview)\\n━━━━━━━━━━━━━━━━\\n' +
        'Total Supply: ' + formatCoin(d.totalSupply) + ' Bal\\n' +
        'Bot Bank: ' + formatCoin(d.ownerBalance) + ' Bal\\n' +
        'VIP WR: ' + d.vipWinRate + '%\\nLegacy Slot WR: ' + d.legacySlotWinRate + '%\\n' +
        Object.entries(web).map(([game, rtp]) => game.toUpperCase() + ': ' + rtp + '%').join(' · '), message.message_id);
    }
    if (command?.name === 'addbal' || command?.name === 'rmbal') {
      const mode = command.name === 'addbal' ? 'add' : 'remove';
      const target = message.reply_to_message?.from;
      const targetId = target?.id || Number(adminValues[0]);
      const rawAmount = target ? adminValues[0] : adminValues[1];
      if (target) await ensureUser(target);
      if (!targetId || !rawAmount) return send(chatId, 'အသုံးပြုပုံ: reply + /' + command.name + ' <amount> သို့မဟုတ် /' + command.name + ' <userId> <amount>', message.message_id);
      const result = await ownerAdjustBalance({
        actorId: from.id, targetUserId: targetId, amount: rawAmount, mode,
        idempotencyKey: 'owner-' + mode + ':' + from.id + ':' + chatId + ':' + message.message_id,
      });
      return send(chatId, (mode === 'add' ? '✅ Balance Added' : '✅ Balance Removed') +
        '\\nUser ID: ' + targetId + '\\nAmount: ' + (mode === 'add' ? '+' : '-') + formatCoin(result.amount) +
        ' Bal\\nBefore: ' + formatCoin(result.before) + ' Bal\\nAfter: ' + formatCoin(result.after) +
        ' Bal\\nBot Bank: ' + formatCoin(result.treasury) + ' Bal' +
        (result.duplicate ? '\\n(Duplicate request safely ignored)' : ''), message.message_id);
    }

    if (command?.name === 'shopon' || command?.name === 'shopoff') {
      const enabled = command.name === 'shopon';
      await setShopEnabled(from.id, enabled);
      return send(chatId, enabled ? '✅ Shop System ON' : '⛔ Shop System OFF', message.message_id);
    }
    if (command?.name === 'sellon' || command?.name === 'selloff') {
      const enabled = command.name === 'sellon';
      await setSetting('sell_system_enabled', { enabled, updatedBy: from.id, updatedAt: new Date().toISOString() });
      return send(chatId, enabled ? '✅ Sell System ON' : '⛔ Sell System OFF', message.message_id);
    }

    if (command?.name === 'shop') {
      if (message.chat?.type !== 'private') return send(chatId, 'ℹ️ /shop ကို bot private chat ထဲမှာပဲ သုံးပါ။', message.message_id);
      if (!(await getShopEnabled()) && !isConfiguredOwner(from.id)) return send(chatId, '⛔ Shop System ပိတ်ထားပါတယ်။', message.message_id);
      const cards = await listAvailableShopCards(25);
      if (!cards.length) return send(chatId, '🎁 BIKA Card Shop\\nStock မရှိသေးပါ။ Owner က /shopstock နဲ့ preview catalog ဖြည့်ပေးရပါမယ်။', message.message_id);
      const rows = [];
      for (let i = 0; i < cards.length; i += 2) rows.push(cards.slice(i, i + 2).map(card => ({
        text: String(card.botKey || 'BIKA') + ' · ' + String(card.rarity || 'Card') + ' · #' + card.id,
        callback_data: 'shop:view:' + card.id,
      })));
      rows.push([{ text: '📦 My Orders', callback_data: 'shop:myorders:0' }, { text: '🎒 Inventory', callback_data: 'shop:inventory:0' }]);
      return send(chatId, '🎁 BIKA Coin To Card Shop\\nCard တစ်ခုရွေးပြီး price ကြည့်ပါ။ Confirm လုပ်ပြီး Owner approve ဖြစ်မှ card ကို inventory ထဲထည့်ပေးပါမယ်။',
        message.message_id, keyboard(rows));
    }
    if (command?.name === 'shopstock') {
      const values = args(command.args);
      if (values.length < 4) return send(chatId, 'Usage: /shopstock <botKey> <cardId> <rarity> <price> <name>', message.message_id);
      const result = await addShopCard({ actorId: from.id, botKey: values[0], cardId: values[1], rarity: values[2], price: values[3], name: values.slice(4).join(' ') || values[1] });
      return send(chatId, '✅ Shop stock added\\nBot: ' + result.botKey + '\\nCard ID: ' + result.cardId + '\\nRarity: ' + result.rarity + '\\nPrice: ' + formatCoin(result.price) + ' Bal', message.message_id);
    }
    if (command?.name === 'inventory') {
      const cards = await listUserInventory(from.id, 50);
      if (!cards.length) return send(chatId, '🎒 Inventory\\nOwned card မရှိသေးပါ။', message.message_id);
      return send(chatId, '🎒 Your Inventory\\n' + cards.map((card, i) => (i + 1) + '. ' + (card.name || card.cardId) +
        ' · ' + card.botKey + ' · ' + card.rarity + ' · #' + card.id).join('\\n'), message.message_id);
    }
    if (command?.name === 'myorders') {
      const orders = await listUserShopOrders(from.id, 10);
      if (!orders.length) return send(chatId, '📦 My Orders\\nOrder မရှိသေးပါ။', message.message_id);
      return send(chatId, '📦 My Shop Orders\\n' + orders.map((order, i) => (i + 1) + '. ' + order.id +
        ' · ' + order.status.toUpperCase() + ' · ' + formatCoin(order.amount) + ' Bal').join('\\n'), message.message_id);
    }
    if (command?.name === 'shoporders') {
      if (!isConfiguredOwner(from.id)) throw new Error('OWNER_ONLY');
      const orders = await listPendingShopOrders(20);
      if (!orders.length) return send(chatId, '📦 Pending shop order မရှိပါ။', message.message_id);
      return send(chatId, '📦 Pending Shop Orders\\n' + orders.map((order, i) => (i + 1) + '. ' + order.id +
        ' · User ' + order.userId + ' · ' + formatCoin(order.amount) + ' Bal').join('\\n'), message.message_id);
    }
    if (command?.name === 'sellpriceadd') {
      const values = args(command.args);
      if (values.length < 3) return send(chatId, 'Usage: /sellpriceadd <botKey> <rarity> <price>', message.message_id);
      const result = await setSellPrice({ actorId: from.id, botKey: values[0], rarity: values[1], price: values[2] });
      return send(chatId, '✅ Sell price saved\\nKey: ' + result.key + '\\nPrice: ' + formatCoin(result.price) + ' Bal', message.message_id);
    }
    if (command?.name === 'sell') {
      if (message.chat?.type !== 'private') return send(chatId, 'ℹ️ /sell ကို bot private chat ထဲမှာပဲ သုံးပါ။', message.message_id);
      const values = args(command.args);
      if (values.length < 3) return send(chatId, '💳 Card Sell System\\nUsage: /sell <botKey> <rarity> <Telegram_Gift_Message_Link>\\nဥပမာ: /sell catchbot legendary https://t.me/YourGiftChannel/123\\nOwner approve လုပ်ပြီးမှ preview Bal ထည့်ပေးပါမယ်။', message.message_id);
      const order = await createSellOrder({ seller: from, botKey: values[0], rarity: values[1], giftLink: values.slice(2).join(' ') });
      let ownerAlertSent = false;
      if (isConfiguredOwner(Number(from.id)) === false) {
        try {
          await api.sendMessage({ chat_id: Number(SERVERLESS_OWNER_TELEGRAM_ID), text: '💳 New Sell Order\\nID: ' + order.order.id +
            '\\nSeller: ' + from.id + '\\nType: ' + order.order.data.botKey + ' / ' + order.order.data.rarity +
            '\\nPrice: ' + formatCoin(order.order.price) + ' Bal\\nGift Link: ' + order.order.data.giftLink,
            reply_markup: keyboard([[{ text: '✅ Approve', callback_data: 'selladmin:approve:' + order.order.id },
              { text: '❌ Cancel', callback_data: 'selladmin:cancel:' + order.order.id }]]) });
          ownerAlertSent = true;
        } catch (_) {}
      }
      return send(chatId, '✅ Sell order created\\nOrder ID: ' + order.order.id + '\\nReceipt: ' + order.order.receiptCode +
        '\\nPrice: ' + formatCoin(order.order.price) + ' Bal\\nStatus: PENDING OWNER APPROVAL\\nOwner Alert: ' + (ownerAlertSent ? 'SENT' : 'FAILED / OWNER NOT CONFIGURED'), message.message_id);
    }
    if (command?.name === 'sellorders') {
      const ownerView = isConfiguredOwner(from.id);
      const list = await listSellOrders({ userId: ownerView ? null : from.id, pendingOnly: ownerView, limit: 20 });
      if (!list.length) return send(chatId, '💳 Sell Orders\\nOrder မရှိသေးပါ။', message.message_id);
      return send(chatId, (ownerView ? '🔔 Pending Sell Orders' : '💳 My Sell Orders') + '\\n' +
        list.map((order, i) => (i + 1) + '. ' + order.id + ' · ' + order.status.toUpperCase() +
          ' · ' + formatCoin(order.price) + ' Bal · User ' + order.sellerId).join('\\n'), message.message_id);
    }

    if (command?.name === 'setevent') {
      if (!['group', 'supergroup'].includes(message.chat?.type)) {
        return send(chatId, '/setevent ကို linked discussion group ထဲမှာပဲ သုံးပါ။', message.message_id);
      }
      const root = message.reply_to_message;
      if (!root?.message_id ||
          !(root.is_automatic_forward === true || root.forward_origin?.type === 'channel' ||
            root.sender_chat?.type === 'channel' || /@BikaGameBot\\b/i.test(String(root.text || root.caption || '')))) {
        return send(chatId, '⚠️ Linked channel post ကို reply လုပ်ပြီး /setevent ကို ပို့ပါ။', message.message_id);
      }
      const parsed = parseSetEventText(message.text);
      if (!parsed) {
        return send(chatId, 'Format မမှန်ပါ။\n/setevent Team A vs Team B\n2x | 1.5x\nvan | pan', message.message_id);
      }
      const event = await createSportsEvent({
        chatId, rootMessageId: root.message_id, sourceChatId: root.sender_chat?.id || root.forward_from_chat?.id || root.chat?.id || chatId,
        sourceText: root.text || root.caption || '', title: parsed.title, teams: parsed.teams, createdBy: from.id,
      });
      const announcement = await send(chatId,
        '🎯 NEW SPORTS EVENT\\n━━━━━━━━━━━━━━━━\\n' + event.title + '\\n' +
        event.data.teams.map(t => t.name + ' — ' + t.odd + 'x (' + t.alias + ')').join('\\n') +
        '\\n━━━━━━━━━━━━━━━━\\nBet တင်ရန် event post ကို reply လုပ်ပါ။\\n' +
        '.bet ' + event.data.teams[0].alias + ' 1000\\n.bet ' + event.data.teams[1].alias + ' 1000',
        root.message_id);
      const sentMessageId = Number(announcement?.message_id ?? announcement?.result?.message_id);
      if (sentMessageId > 0) await rememberSportsThreadMessage(event.id, sentMessageId);
      return announcement;
    }

    if (command?.name === 'stopbet' || command?.name === 'betwin') {
      const event = await findSportsEventForReply(chatId, message.reply_to_message);
      if (!event) return send(chatId, 'ဒီ reply/thread အတွက် active Sports Event မတွေ့ပါ။ Event post ကို reply လုပ်ပါ။', message.message_id);
      if (command.name === 'stopbet') {
        const result = await stopSportsEvent(event, from.id);
        return send(chatId, result.duplicate ? 'ℹ️ Betting ပိတ်ပြီးသားပါ။' : '🔒 Betting ပိတ်ပါပြီ။ Winner alias ကို .betwin <alias> နဲ့ သတ်မှတ်ပါ။', message.message_id);
      }
      const alias = String(command.args || '').trim().split(/\\s+/)[0];
      if (!alias) return send(chatId, '.betwin <team_alias> ပုံစံသုံးပါ။', message.message_id);
      const result = await settleSportsEvent(event, alias, from.id);
      const winners = result.bets.filter(b => String(b.choice || '').toLowerCase() === String(alias).toLowerCase()).length;
      const totalPaid = result.bets.filter(b => b.choice === alias.toLowerCase()).reduce((sum, b) => sum + Number(b.potentialWin || 0), 0);
      return send(chatId, (result.duplicate ? 'ℹ️ Event settle လုပ်ပြီးသားပါ။' : '✅ Sports settlement complete.') +
        '\\nEvent: ' + event.title + '\\nWinner: ' + alias.toLowerCase() +
        '\\nWinning bets: ' + winners + '\\nTotal payout: ' + formatCoin(totalPaid) + ' Bal', message.message_id);
    }

    if (command?.name === 'bet') {
      if (!['group', 'supergroup'].includes(message.chat?.type)) {
        return send(chatId, '.bet ကို event discussion group ထဲမှာပဲ သုံးပါ။', message.message_id);
      }
      const parsed = String(command.args || '').trim().split(/\\s+/);
      if (parsed.length < 2) return send(chatId, 'အသုံးပြုပုံ: event post ကို reply လုပ်ပြီး .bet <alias> <amount>', message.message_id);
      const event = await findSportsEventForReply(chatId, message.reply_to_message);
      if (!event) return send(chatId, 'Sports Event post ကို reply လုပ်ပေးပါ။', message.message_id);
      const result = await placeSportsBet({ event, telegramUser: from, alias: parsed[0], amount: parsed[1], messageId: message.message_id });
      const team = event.data.teams.find(t => t.alias === String(parsed[0]).toLowerCase());
      return send(chatId, '✅ SPORTS BET ACCEPTED\\n' + team.name + ' (' + team.alias + ')' +
        '\\nBet: ' + formatCoin(result.bet.amount) + ' Bal' +
        '\\nPotential win: ' + formatCoin(result.bet.potentialWin) + ' Bal' +
        '\\nBalance: ' + formatCoin(result.balance) + ' Bal', message.message_id);
    }

    if (command?.name === 'auctionchannel') {
      if (!isConfiguredOwner(from.id)) throw new Error('OWNER_ONLY');
      const channelId = Number(String(command.args || '').trim());
      if (!Number.isSafeInteger(channelId) || channelId === 0) throw new Error('AUCTION_CHANNEL_INVALID');
      await setSetting('auction_channel_id', channelId);
      return send(chatId, '✅ Auction channel configured: ' + channelId, message.message_id);
    }
    if (command?.name === 'auction') {
      const values = args(command.args);
      if (values.length < 3) {
        return send(chatId, 'အသုံးပြုပုံ: /auction <starting_bid> <min_increment> <minutes> <title>\\nဥပမာ: /auction 10000 1000 30 Yae Miko Card', message.message_id);
      }
      const media = message.reply_to_message;
      const mediaType = media?.photo?.length ? 'photo' : media?.video?.file_id ? 'video' : null;
      const fileId = mediaType === 'photo' ? media.photo[media.photo.length - 1].file_id : mediaType === 'video' ? media.video.file_id : null;
      const result = await createAuction({ actorId: from.id, chatId, startingBid: values[0], minIncrement: values[1], minutes: values[2], title: values.slice(3).join(' ') || 'Auction Item', mediaType, fileId });
      return send(chatId, '✅ Auction created and posted.\\nAuction ID: ' + result.auctionId +
        '\\nChannel: ' + result.channelId + '\\nEnds: ' + result.endAt, message.message_id);
    }
    if (command?.name === 'auctionstatus') {
      if (!isConfiguredOwner(from.id)) throw new Error('OWNER_ONLY');
      const rows = await showAuctionStatus(command.args.trim() || null);
      if (!rows.length) return send(chatId, 'Auction record မရှိသေးပါ။', message.message_id);
      return send(chatId, rows.map(a => '💎 ' + a.title + '\\nID: ' + a.auctionId + '\\nStatus: ' + a.status +
        '\\nCurrent bid: ' + formatCoin(a.currentBid || a.startingBid) + ' Bal\\nBids: ' + a.totalBids +
        '\\nHighest bidder: ' + (a.highestBidderName || a.highestBidderId || 'None') +
        '\\nEnds: ' + (a.endAt ? new Date(a.endAt).toISOString() : '—')).join('\\n\\n'), message.message_id);
    }
    if (command?.name === 'auctionfinish') {
      const result = await finalizeAuction(String(command.args || '').trim(), from.id, true);
      return send(chatId, result.duplicate ? 'ℹ️ Auction already finalized.' : '✅ Auction finalized: ' + result.auction.auctionId +
        '\\nStatus: ' + result.auction.status, message.message_id);
    }
    if (command?.name === 'auctioncancel') {
      const result = await cancelAuction(String(command.args || '').trim(), from.id);
      return send(chatId, result.duplicate ? 'ℹ️ Auction already cancelled.' : '🛑 Auction cancelled and current bid refunded.', message.message_id);
    }
    if (command?.name === 'bid' || isAuctionPlainBid) {
      const bidAmount = command?.name === 'bid' ? command.args : String(message.text || '').trim();
      const auction = await findAuctionForReply(message);
      if (!auction) return send(chatId, 'Auction post ကို reply လုပ်ပြီး .bid <amount> သို့မဟုတ် amount တစ်ခု ပို့ပါ။', message.message_id);
      const result = await placeAuctionBid({ auction, telegramUser: from, amount: bidAmount, messageId: message.message_id, bidChatId: chatId });
      return send(chatId, '✅ AUCTION BID ACCEPTED\\nAuction: ' + auction.auctionId +
        '\\nNew bid: ' + formatCoin(result.auction.currentBid) + ' Bal' +
        '\\nBalance: ' + formatCoin(result.balance) + ' Bal' +
        (result.previousBidderId ? '\\nPrevious top bid refunded.' : ''), message.message_id);
    }

    if (command?.name === 'dailytournament' || command?.name === 'tournament') {
      if (!['group', 'supergroup'].includes(message.chat?.type)) return send(chatId, 'Daily Tournament ကို group ထဲမှာပဲ ကြည့်နိုင်ပါတယ်။', message.message_id);
      const rows = await getDailyTournament({ game: 'mines', chatId, limit: 10 });
      if (!rows.length) return send(chatId, '🏆 BIKA Daily Mines Tournament\\nဒီနေ့ record မရှိသေးပါ။\\nစတင်ရန်: /mines 1000', message.message_id);
      const lines = rows.map((row, i) => (i + 1) + '. ' + (row.username ? '@' + row.username : (row.firstName || 'Player ' + row.userId)) +
        ' — Profit: ' + formatCoin(row.score || 0) + ' Bal · Best: ' + formatCoin(row.bestWin || 0) +
        ' · Games: ' + Number(row.games || 0));
      return send(chatId, '🏆 BIKA DAILY MINES TOURNAMENT\\n' + lines.join('\\n'), message.message_id);
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
      const transferArgs = args(command.args);
      if (transferArgs.length < 2) return send(chatId, 'အသုံးပြုပုံ: /transfer <Wallet_ID> <amount>', message.message_id);
      const transferId = 'tg:' + String(chatId) + ':' + String(message.message_id);
      const result = await transferByWalletId(from.id, transferArgs[0], transferArgs[1],
        { source: 'telegram_command', chatId, messageId: message.message_id }, 'wallet-transfer:' + from.id + ':' + transferId);
      return send(chatId, '✅ Transfer complete\\nAmount: ' + formatCoin(result.amount) + ' Bal\\nYour balance: ' +
        formatCoin(result.sender?.balance || 0) + ' Bal\\nRecipient: ' + (result.recipient?.walletId || transferArgs[0]), message.message_id);
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
          'Wallet ID: ' + (user.walletId || 'pending') + '\n\nPreview database only.',
        message.message_id,
      );
    }
    if (command.name === 'wallet') {
      return send(
        chatId,
        '💳 BIKA Preview Wallet\n' +
          'ID: ' + (user.walletId || 'pending') + '\n' +
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
      const result = await playSlot(user.tgId, bet, 'tg:' + chatId + ':' + message.message_id, { groupId: chatId, source: 'telegram' });
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
      const result = await playPlinko(user.tgId, bet, 'tg:' + chatId + ':' + message.message_id);
      return send(
        chatId,
        '🟡 PLINKO\nMultiplier: x' + result.multiplier +
          '\nPayout: ' + formatCoin(result.payout) + ' $' +
          '\nBalance: ' + formatCoin(result.balance) + ' $',
        message.message_id,
      );
    }
    if (command.name === 'wheel') {
      const result = await wheelSpin(user.tgId, bet, 'tg:' + chatId + ':' + message.message_id);
      return send(
        chatId,
        '🎡 LUCKY WHEEL\nReward: ' + result.reward + '%' +
          '\nPayout: ' + formatCoin(result.payout) + ' $' +
          '\nBalance: ' + formatCoin(result.balance) + ' $',
        message.message_id,
      );
    }
    if (command.name === 'crash') {
      const result = await crashStart(user.tgId, bet, 'tg:' + chatId + ':' + message.message_id);
      return send(
        chatId,
        '🚀 ROCKET CRASH\nRound started.\nCurrent: x1.00\n\nPress Cash Out before the rocket crashes.',
        message.message_id,
        keyboard([[{ text: '💰 CASH OUT', callback_data: 'crash:cashout:' + result.sessionId }]]),
      );
    }
    if (command.name === 'mines' || command.name === 'mine') {
      await assertGameEnabled('mines');
      await minesStart(user.tgId, bet, 'tg:' + chatId + ':' + message.message_id);
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
