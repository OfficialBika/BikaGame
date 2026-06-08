'use strict';

const { ObjectId } = require('mongodb');
const { COIN } = require('../../config/constants');
const orderModel = require('../../models/orderModel');
const shopCardModel = require('../../models/shopCardModel');
const shopSettingModel = require('../../models/shopSettingModel');
const {
  getUser,
  userPayToTreasury,
  treasuryPayToUser,
} = require('../../services/economyService');
const {
  ensureTreasury,
  isOwner,
} = require('../../services/treasuryService');
const { replyHTML, editByIds } = require('../../utils/telegram');
const { fmt, escHtml } = require('../../utils/format');
const { mentionHtml } = require('../../utils/helpers');

const pendingOrders = new Map();

const ORDER_TIMEOUT_MS = Number(process.env.SHOP_CONFIRM_TIMEOUT_MS || 60_000);
const MAX_PENDING_ORDERS = Number(process.env.SHOP_MAX_PENDING || 10_000);

const RARITIES = Object.freeze([
  Object.freeze({ key: 'rare', label: 'Rare', icon: '🔵', defaultPrice: 100_000 }),
  Object.freeze({ key: 'legendary', label: 'Legendary', icon: '🟡', defaultPrice: 1_000_000 }),
  Object.freeze({ key: 'mystical', label: 'Mystical', icon: '💮', defaultPrice: 2_500_000 }),
  Object.freeze({ key: 'divine', label: 'Divine', icon: '⚜️', defaultPrice: 5_000_000 }),
  Object.freeze({ key: 'crossverse', label: 'CrossVerse', icon: '⚡', defaultPrice: 10_000_000 }),
  Object.freeze({ key: 'cataphract', label: 'Cataphract', icon: '✨', defaultPrice: 25_000_000 }),
  Object.freeze({ key: 'supreme', label: 'Supreme', icon: '🪞', defaultPrice: 50_000_000 }),
]);

function normalizeRarity(input) {
  const raw = String(input || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!raw) return null;

  const aliases = {
    rare: 'rare',
    legendary: 'legendary',
    mystical: 'mystical',
    divine: 'divine',
    crossverse: 'crossverse',
    cross: 'crossverse',
    cataphract: 'cataphract',
    cata: 'cataphract',
    supreme: 'supreme',
  };

  return aliases[raw] || null;
}

function rarityInfo(key) {
  return RARITIES.find((rarity) => rarity.key === key) || null;
}

function rarityLabel(key) {
  const info = rarityInfo(key);
  return info ? `${info.icon} ${info.label}` : escHtml(String(key || 'Unknown'));
}

function privateOnly(ctx) {
  return ctx.chat?.type === 'private';
}

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

async function editCurrentHTML(ctx, html, extra = {}) {
  try {
    return await ctx.editMessageText(html, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  } catch (err) {
    const message = String(err?.message || err);

    if (
      message.includes('message is not modified') ||
      message.includes('message to edit not found') ||
      message.includes('there is no text in the message to edit')
    ) {
      return null;
    }

    throw err;
  }
}

async function deleteCallbackMessage(ctx) {
  try {
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (messageId) {
      await ctx.deleteMessage(messageId);
    }
  } catch (_) {}
}


function makePendingId() {
  return `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function makeReceiptCode() {
  return `BIKA-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
}

function parseAmount(value) {
  const n = Number(String(value || '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.floor(n));
}

async function requireOwner(ctx) {
  const treasury = await ensureTreasury();

  if (!isOwner(ctx, treasury)) {
    await replyHTML(ctx, '⛔ Owner only.', replyOptions(ctx));
    return null;
  }

  return treasury;
}

async function requireOwnerDm(ctx) {
  const treasury = await requireOwner(ctx);
  if (!treasury) return null;

  if (!privateOnly(ctx)) {
    await replyHTML(ctx, 'ℹ️ ဒီ shop admin command ကို bot DM ထဲမှာပဲ သုံးပါ။', replyOptions(ctx));
    return null;
  }

  return treasury;
}

async function getPriceMap() {
  const doc = await shopSettingModel.collection().findOne({ key: 'rarity_prices' });
  const prices = { ...(doc?.prices || {}) };

  for (const rarity of RARITIES) {
    if (!Number.isFinite(Number(prices[rarity.key])) || Number(prices[rarity.key]) <= 0) {
      prices[rarity.key] = rarity.defaultPrice;
    } else {
      prices[rarity.key] = Math.floor(Number(prices[rarity.key]));
    }
  }

  return prices;
}

async function setRarityPrice(key, amount) {
  const prices = await getPriceMap();
  prices[key] = Math.floor(Number(amount));

  await shopSettingModel.collection().updateOne(
    { key: 'rarity_prices' },
    {
      $set: { key: 'rarity_prices', prices, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );

  return prices[key];
}

async function countAvailableByRarity() {
  const counts = {};
  for (const rarity of RARITIES) counts[rarity.key] = 0;

  const docs = await shopCardModel.collection()
    .aggregate([
      { $match: { status: 'AVAILABLE' } },
      { $group: { _id: '$rarity', count: { $sum: 1 } } },
    ])
    .toArray();

  for (const doc of docs) {
    if (doc?._id) counts[doc._id] = doc.count || 0;
  }

  return counts;
}

function shopHomeText(balance, prices, counts) {
  const lines = RARITIES.map((rarity) => (
    `${rarity.icon} <b>${rarity.label}</b>\n` +
    `   Price: <b>${fmt(prices[rarity.key])}</b> ${COIN}\n` +
    `   Stock: <b>${fmt(counts[rarity.key] || 0)}</b> cards`
  )).join('\n\n');

  return (
    `🛒 <b>BIKA Characters Card Shop</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${lines}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `💼 Your Balance: <b>${fmt(balance)}</b> ${COIN}\n` +
    `📌 Rarity ရွေးပါ → Card ID ရွေးပါ → Confirm နှိပ်ပါ။`
  );
}

function shopHomeKeyboard(counts) {
  const rows = RARITIES.map((rarity) => [
    {
      text: `${rarity.icon} ${rarity.label} (${counts[rarity.key] || 0})`,
      callback_data: `BUY:R:${rarity.key}`,
    },
  ]);

  rows.push([
    { text: '📦 My Orders', callback_data: 'SHOP:MYORDERS' },
    { text: 'ℹ️ Help', callback_data: 'SHOP:HELP' },
  ]);

  return { inline_keyboard: rows };
}

async function rarityCardsText(rarityKey, price) {
  const rarity = rarityInfo(rarityKey);
  const cards = await shopCardModel.collection()
    .find({ rarity: rarityKey, status: 'AVAILABLE' })
    .sort({ cardId: 1 })
    .limit(30)
    .toArray();

  if (!cards.length) {
    return {
      text:
        `🎴 <b>${rarityLabel(rarityKey)} Cards</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `ဒီ rarity မှာ available card မရှိသေးပါ။`,
      cards,
    };
  }

  const cardLines = cards.map((card, index) => (
    `${index + 1}. <code>${escHtml(card.cardId)}</code>${card.name ? ` — ${escHtml(card.name)}` : ''}`
  )).join('\n');

  return {
    text:
      `🎴 <b>${rarity?.icon || ''} ${rarity?.label || rarityKey} Cards</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `Price: <b>${fmt(price)}</b> ${COIN}\n` +
      `Available: <b>${cards.length}</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${cardLines}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `ဝယ်ချင်တဲ့ Card ID ကိုရွေးပါ။`,
    cards,
  };
}

function cardsKeyboard(cards) {
  const rows = [];
  let row = [];

  for (const card of cards) {
    row.push({
      text: String(card.cardId).slice(0, 24),
      callback_data: `SHOP:CARD:${String(card._id)}`,
    });

    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }

  if (row.length) rows.push(row);
  rows.push([{ text: '⬅️ Back to Rarity', callback_data: 'BUY:HOME' }]);

  return { inline_keyboard: rows };
}

function previewText(ctx, card, price) {
  return (
    `🧾 <b>Order Preview</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Buyer: ${mentionHtml(ctx.from)}\n` +
    `Buyer ID: <code>${ctx.from.id}</code>\n` +
    `Rarity: <b>${rarityLabel(card.rarity)}</b>\n` +
    `Card ID: <code>${escHtml(card.cardId)}</code>\n` +
    `${card.name ? `Name: <b>${escHtml(card.name)}</b>\n` : ''}` +
    `Price: <b>${fmt(price)}</b> ${COIN}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `✅ Confirm နှိပ်မှ balance ဖြတ်ပြီး order တင်ပါမယ်။`
  );
}

function previewKeyboard(pendingId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirm Order', callback_data: `SHOP:OK:${pendingId}` },
        { text: '❌ Cancel', callback_data: `SHOP:NO:${pendingId}` },
      ],
    ],
  };
}

function buyerPendingText(order, insertedId, balance, ownerNotified) {
  return (
    `✅ <b>Order Created</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Order ID: <code>${String(insertedId)}</code>\n` +
    `Receipt: <code>${order.receiptCode}</code>\n` +
    `Buyer ID: <code>${order.userId}</code>\n` +
    `Rarity: <b>${rarityLabel(order.card.rarity)}</b>\n` +
    `Card ID: <code>${escHtml(order.card.cardId)}</code>\n` +
    `${order.card.name ? `Name: <b>${escHtml(order.card.name)}</b>\n` : ''}` +
    `Paid: <b>${fmt(order.price)}</b> ${COIN}\n` +
    `Balance: <b>${fmt(balance)}</b> ${COIN}\n` +
    `Status: <b>PENDING OWNER APPROVAL</b>\n` +
    `Owner Alert: <b>${ownerNotified ? 'SENT ✅' : 'FAILED ⚠️'}</b>`
  );
}

function ownerOrderText(order, insertedId) {
  return (
    `🛒 <b>New Card Order</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Order ID: <code>${String(insertedId)}</code>\n` +
    `Receipt: <code>${order.receiptCode}</code>\n` +
    `Buyer: ${mentionHtml(order.buyer)}\n` +
    `Buyer ID: <code>${order.userId}</code>\n` +
    `Username: <code>${escHtml(order.buyer.username ? '@' + order.buyer.username : 'N/A')}</code>\n` +
    `Rarity: <b>${rarityLabel(order.card.rarity)}</b>\n` +
    `Card ID: <code>${escHtml(order.card.cardId)}</code>\n` +
    `${order.card.name ? `Name: <b>${escHtml(order.card.name)}</b>\n` : ''}` +
    `Paid: <b>${fmt(order.price)}</b> ${COIN}\n` +
    `Status: <b>PENDING</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Approve လုပ်ရင် buyer DM ကို completed message ပို့ပါမယ်။\n` +
    `Cancel လုပ်ရင် refund + buyer DM ပို့ပါမယ်။`
  );
}

function ownerOrderKeyboard(orderId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `SHOPADMIN:APPROVE:${orderId}` },
        { text: '❌ Cancel', callback_data: `SHOPADMIN:CANCEL:${orderId}` },
      ],
    ],
  };
}

function buyerCompletedText(order) {
  return (
    `✅ <b>Order ပြီးမြောက်ပါပြီ</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Receipt: <code>${escHtml(order.receiptCode || 'N/A')}</code>\n` +
    `Rarity: <b>${rarityLabel(order.rarity)}</b>\n` +
    `Card ID: <code>${escHtml(order.cardId || 'N/A')}</code>\n` +
    `${order.itemName ? `Name: <b>${escHtml(order.itemName)}</b>\n` : ''}` +
    `Paid: <b>${fmt(order.price || 0)}</b> ${COIN}\n` +
    `Status: <b>COMPLETED ✅</b>`
  );
}

function buyerCancelledText(order, refunded) {
  return (
    `❌ <b>Order Cancelled</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Receipt: <code>${escHtml(order.receiptCode || 'N/A')}</code>\n` +
    `Rarity: <b>${rarityLabel(order.rarity)}</b>\n` +
    `Card ID: <code>${escHtml(order.cardId || 'N/A')}</code>\n` +
    `${order.itemName ? `Name: <b>${escHtml(order.itemName)}</b>\n` : ''}` +
    `Amount: <b>${fmt(order.price || 0)}</b> ${COIN}\n` +
    `Refund: <b>${refunded ? 'DONE ✅' : 'FAILED ⚠️'}</b>\n` +
    `Status: <b>CANCELLED</b>`
  );
}

function ownerCompletedText(order, action) {
  return (
    `${action === 'APPROVE' ? '✅ <b>Order Approved</b>' : '❌ <b>Order Cancelled</b>'}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Order ID: <code>${String(order._id)}</code>\n` +
    `Receipt: <code>${escHtml(order.receiptCode || 'N/A')}</code>\n` +
    `Buyer ID: <code>${order.userId}</code>\n` +
    `Rarity: <b>${rarityLabel(order.rarity)}</b>\n` +
    `Card ID: <code>${escHtml(order.cardId || 'N/A')}</code>\n` +
    `Paid: <b>${fmt(order.price || 0)}</b> ${COIN}\n` +
    `Status: <b>${action === 'APPROVE' ? 'COMPLETED' : 'CANCELLED'}</b>`
  );
}

function cancelledText(order) {
  return (
    `❌ <b>Order Cancelled</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Rarity: <b>${rarityLabel(order.card.rarity)}</b>\n` +
    `Card ID: <code>${escHtml(order.card.cardId)}</code>\n` +
    `Price: <b>${fmt(order.price)}</b> ${COIN}`
  );
}

function expiredText(order) {
  return (
    `⌛ <b>Order Expired</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Rarity: <b>${rarityLabel(order.card.rarity)}</b>\n` +
    `Card ID: <code>${escHtml(order.card.cardId)}</code>\n` +
    `Price: <b>${fmt(order.price)}</b> ${COIN}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<code>/shop</code> ပြန်ဖွင့်ပြီး order အသစ်တင်ပါ။`
  );
}

function helpText() {
  return (
    `ℹ️ <b>BIKA Character Shop Help</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Buyer:\n` +
    `• <code>/shop</code> or <code>.shop</code>\n` +
    `• Rarity ရွေးပါ\n` +
    `• Card ID ရွေးပါ\n` +
    `• Confirm နှိပ်ပါ\n\n` +
    `Rule:\n` +
    `• <b>Bot Dm မှာ /start နှိပ်ထားဖို့လိုအပ်ပါတယ်</b>\n` +
    `• <b>Confirm နှိပ်ပြီးရင် Cancel နှိပ်မရတော့ပါ</b>\n` +
    `• <b>မိမိရဲ့ လက်ကျန်ငွေ မလုံလောက်ရင် ဝယ်ယူလို့မရနိူင်ပါ</b>\n` +
    `• Order တင်​ပြီးရင် My Order ထဲမှာ မိမိရဲ့ order တွေစစ်ဆေးလို့ရပါတယ်။`
  );
}

function cleanupPendingOrders() {
  const now = Date.now();

  for (const [id, order] of pendingOrders.entries()) {
    if (order.expiresAt <= now) {
      if (order.timeoutHandle) clearTimeout(order.timeoutHandle);
      pendingOrders.delete(id);
    }
  }

  if (pendingOrders.size > MAX_PENDING_ORDERS) {
    const deleteCount = Math.ceil(pendingOrders.size * 0.20);
    let deleted = 0;

    for (const [id, order] of pendingOrders.entries()) {
      if (order.timeoutHandle) clearTimeout(order.timeoutHandle);
      pendingOrders.delete(id);
      deleted += 1;
      if (deleted >= deleteCount) break;
    }
  }
}

function clearPending(id) {
  const order = pendingOrders.get(id);
  if (order?.timeoutHandle) clearTimeout(order.timeoutHandle);
  pendingOrders.delete(id);
  return order;
}

async function myOrdersText(userId) {
  const orders = await orderModel.collection()
    .find({ userId })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  if (!orders.length) {
    return `📦 <b>My Orders</b>\n━━━━━━━━━━━━━━━━\nOrder မရှိသေးပါ။`;
  }

  const lines = orders.map((order, index) => (
    `${index + 1}. <code>${String(order._id)}</code>\n` +
    `   Buyer ID: <code>${order.userId}</code>\n` +
    `   Rarity: <b>${escHtml(order.rarity || 'N/A')}</b>\n` +
    `   Card ID: <code>${escHtml(order.cardId || order.itemId || 'N/A')}</code>\n` +
    `   Paid: <b>${fmt(order.price || 0)}</b> ${COIN}\n` +
    `   Status: <b>${escHtml(order.status || 'PENDING')}</b>`
  )).join('\n\n');

  return `📦 <b>My Recent Orders</b>\n━━━━━━━━━━━━━━━━\n${lines}`;
}

async function openShop(ctx) {
  const user = await getUser(ctx.from.id);
  const prices = await getPriceMap();
  const counts = await countAvailableByRarity();

  return replyHTML(ctx, shopHomeText(user?.balance || 0, prices, counts), {
    ...replyOptions(ctx),
    reply_markup: shopHomeKeyboard(counts),
  });
}

async function showRarity(ctx, rarityKey) {
  const prices = await getPriceMap();
  const { text, cards } = await rarityCardsText(rarityKey, prices[rarityKey]);

  try {
    await ctx.answerCbQuery(`${rarityInfo(rarityKey)?.label || rarityKey} cards`);
  } catch (_) {}

  return editCurrentHTML(ctx, text, { reply_markup: cardsKeyboard(cards) });
}

async function handleBuy(ctx, payload) {
  cleanupPendingOrders();

  if (payload === 'HOME') {
    const user = await getUser(ctx.from.id);
    const prices = await getPriceMap();
    const counts = await countAvailableByRarity();

    try { await ctx.answerCbQuery('Back to shop.'); } catch (_) {}

    return editCurrentHTML(ctx, shopHomeText(user?.balance || 0, prices, counts), {
      reply_markup: shopHomeKeyboard(counts),
    });
  }

  if (!String(payload || '').startsWith('R:')) {
    return ctx.answerCbQuery('Unknown shop action.', { show_alert: true });
  }

  const rarityKey = normalizeRarity(String(payload).split(':')[1]);

  if (!rarityKey || !rarityInfo(rarityKey)) {
    return ctx.answerCbQuery('Rarity not found.', { show_alert: true });
  }

  return showRarity(ctx, rarityKey);
}

module.exports = (bot) => {
  bot.command('shop', openShop);
  bot.hears(/^\.(shop)\s*$/i, openShop);

  bot._bikaHandleBuy = handleBuy;

  bot.on('callback_query', async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || '');

    if (!data.startsWith('SHOP:') && !data.startsWith('SHOPADMIN:')) {
      return next();
    }

    cleanupPendingOrders();

    if (data === 'SHOP:HELP') {
      try { await ctx.answerCbQuery('Help opened.'); } catch (_) {}
      return editCurrentHTML(ctx, helpText(), {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Back to Shop', callback_data: 'BUY:HOME' }]],
        },
      });
    }

    if (data === 'SHOP:MYORDERS') {
      try { await ctx.answerCbQuery('My orders opened.'); } catch (_) {}
      return editCurrentHTML(ctx, await myOrdersText(ctx.from.id), {
        reply_markup: {
          inline_keyboard: [[{ text: '⬅️ Back to Shop', callback_data: 'BUY:HOME' }]],
        },
      });
    }

    if (data.startsWith('SHOPADMIN:')) {
      const [, action, orderId] = data.split(':');
      const treasury = await ensureTreasury();

      if (!isOwner(ctx, treasury)) {
        try {
          await ctx.answerCbQuery('Owner only.', { show_alert: true });
        } catch (_) {}
        return;
      }

      if (!ObjectId.isValid(orderId)) {
        try {
          await ctx.answerCbQuery('Invalid order id.', { show_alert: true });
        } catch (_) {}
        return;
      }

      const order = await orderModel.collection().findOne({ _id: new ObjectId(orderId) });

      if (!order) {
        try {
          await ctx.answerCbQuery('Order not found.', { show_alert: true });
        } catch (_) {}
        return;
      }

      if (order.status !== 'PENDING') {
        try {
          await ctx.answerCbQuery(`Already ${order.status}.`, { show_alert: true });
        } catch (_) {}
        return;
      }

      if (action === 'APPROVE') {
        await orderModel.collection().updateOne(
          { _id: order._id, status: 'PENDING' },
          {
            $set: {
              status: 'COMPLETED',
              approvedByUserId: ctx.from.id,
              approvedAt: new Date(),
              completedAt: new Date(),
              updatedAt: new Date(),
            },
          }
        );

        const updated = await orderModel.collection().findOne({ _id: order._id });

        try {
          await bot.telegram.sendMessage(order.userId, buyerCompletedText(updated), {
            parse_mode: 'HTML',
          });
        } catch (_) {}

        try { await ctx.answerCbQuery('Order approved.'); } catch (_) {}
        return editHTML(ctx, ownerCompletedText(updated, 'APPROVE'));
      }

      if (action === 'CANCEL') {
        let refunded = false;

        try {
          await treasuryPayToUser(order.userId, order.price, {
            type: 'shop_order_refund',
            orderId: String(order._id),
            cardId: order.cardId,
            rarity: order.rarity,
            reason: 'owner_cancel',
          });
          refunded = true;
        } catch (_) {}

        await orderModel.collection().updateOne(
          { _id: order._id, status: 'PENDING' },
          {
            $set: {
              status: 'CANCELLED',
              cancelledByUserId: ctx.from.id,
              cancelledAt: new Date(),
              refunded,
              updatedAt: new Date(),
            },
          }
        );

        await shopCardModel.collection().updateOne(
          { cardId: order.cardId, status: 'SOLD' },
          {
            $set: {
              status: 'AVAILABLE',
              soldToUserId: null,
              soldAt: null,
              updatedAt: new Date(),
            },
          }
        );

        const updated = await orderModel.collection().findOne({ _id: order._id });

        try {
          await bot.telegram.sendMessage(order.userId, buyerCancelledText(updated, refunded), {
            parse_mode: 'HTML',
          });
        } catch (_) {}

        try { await ctx.answerCbQuery('Order cancelled.'); } catch (_) {}
        return editHTML(ctx, ownerCompletedText(updated, 'CANCEL'));
      }

      try {
        await ctx.answerCbQuery('Unknown owner action.', { show_alert: true });
      } catch (_) {}
      return;
    }

    if (data.startsWith('SHOP:CARD:')) {
      const cardObjectId = data.slice('SHOP:CARD:'.length);

      if (!ObjectId.isValid(cardObjectId)) {
        return ctx.answerCbQuery('Invalid card.', { show_alert: true });
      }

      const card = await shopCardModel.collection().findOne({
        _id: new ObjectId(cardObjectId),
        status: 'AVAILABLE',
      });

      if (!card) {
        return ctx.answerCbQuery('Card မရှိတော့ပါ။', { show_alert: true });
      }

      const prices = await getPriceMap();
      const price = prices[card.rarity] || 0;

      const user = await getUser(ctx.from.id);
      if (Number(user?.balance || 0) < price) {
        return ctx.answerCbQuery('❌ Balance မလုံလောက်ပါ။', { show_alert: true });
      }

      const pendingId = makePendingId();
      const expiresAt = Date.now() + ORDER_TIMEOUT_MS;

      try { await ctx.answerCbQuery('Order preview opened.'); } catch (_) {}

      await deleteCallbackMessage(ctx);

      const sent = await replyHTML(ctx, previewText(ctx, card, price), {
        reply_markup: previewKeyboard(pendingId),
      });

      if (!sent?.message_id) return;

      const pending = {
        id: pendingId,
        userId: ctx.from.id,
        buyer: ctx.from,
        chatId: ctx.chat.id,
        msgId: sent.message_id,
        cardObjectId,
        card,
        price,
        expiresAt,
        timeoutHandle: null,
      };

      pending.timeoutHandle = setTimeout(async () => {
        const expired = pendingOrders.get(pendingId);
        if (!expired) return;
        pendingOrders.delete(pendingId);
        try {
          await editByIds(bot, expired.chatId, expired.msgId, expiredText(expired));
        } catch (_) {}
      }, ORDER_TIMEOUT_MS);

      pendingOrders.set(pendingId, pending);
      return;
    }

    const [, action, id] = data.split(':');

    if (!['OK', 'NO'].includes(action)) {
      try {
        await ctx.answerCbQuery('Unknown shop action.', { show_alert: true });
      } catch (_) {}
      return;
    }

    const pending = pendingOrders.get(id);

    if (!pending) {
      try {
        await ctx.answerCbQuery('Order expired.', { show_alert: true });
      } catch (_) {}
      return;
    }

    if (ctx.from.id !== pending.userId) {
      try {
        await ctx.answerCbQuery('Buyer ပဲ Confirm/Cancel လုပ်နိုင်ပါတယ်။', { show_alert: true });
      } catch (_) {}
      return;
    }

    if (action === 'NO') {
      clearPending(id);
      try { await ctx.answerCbQuery('Order cancelled.'); } catch (_) {}
      return editByIds(bot, pending.chatId, pending.msgId, cancelledText(pending));
    }

    try { await ctx.answerCbQuery('Creating order...'); } catch (_) {}

    try {
      const latestCard = await shopCardModel.collection().findOne({
        _id: new ObjectId(pending.cardObjectId),
        status: 'AVAILABLE',
      });

      if (!latestCard) {
        clearPending(id);
        return editByIds(
          bot,
          pending.chatId,
          pending.msgId,
          '⚠️ <b>Card unavailable</b>\n━━━━━━━━━━━━━━━━\nဒီ card ကို တစ်ခြားသူဝယ်သွားပြီးဖြစ်နိုင်ပါတယ်။'
        );
      }

      await userPayToTreasury(pending.userId, pending.price, {
        type: 'shop_card_buy',
        cardId: latestCard.cardId,
        rarity: latestCard.rarity,
      });

      await shopCardModel.collection().updateOne(
        { _id: latestCard._id, status: 'AVAILABLE' },
        {
          $set: {
            status: 'SOLD',
            soldToUserId: pending.userId,
            soldAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );

      const receipt = makeReceiptCode();

      const inserted = await orderModel.collection().insertOne({
        buyerId: pending.userId,
        userId: pending.userId,
        username: pending.buyer.username ? pending.buyer.username.toLowerCase() : null,
        itemId: latestCard.cardId,
        itemName: latestCard.name || latestCard.cardId,
        cardId: latestCard.cardId,
        rarity: latestCard.rarity,
        price: pending.price,
        receiptCode: receipt,
        status: 'PENDING',
        ownerNotified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      let ownerNotified = false;
      const ownerId = (await ensureTreasury())?.ownerUserId;

      if (ownerId) {
        try {
          const ownerMsg = await bot.telegram.sendMessage(
            ownerId,
            ownerOrderText(
              {
                ...pending,
                card: latestCard,
                receiptCode: receipt,
              },
              inserted.insertedId
            ),
            {
              parse_mode: 'HTML',
              reply_markup: ownerOrderKeyboard(String(inserted.insertedId)),
            }
          );

          ownerNotified = true;

          await orderModel.collection().updateOne(
            { _id: inserted.insertedId },
            {
              $set: {
                ownerNotified: true,
                ownerNotifyMessageId: ownerMsg?.message_id || null,
                updatedAt: new Date(),
              },
            }
          );
        } catch (_) {}
      }

      const updatedUser = await getUser(pending.userId);
      clearPending(id);

      return editByIds(
        bot,
        pending.chatId,
        pending.msgId,
        buyerPendingText(
          {
            ...pending,
            card: latestCard,
            receiptCode: receipt,
            userId: pending.userId,
          },
          inserted.insertedId,
          updatedUser?.balance || 0,
          ownerNotified
        )
      );
    } catch (err) {
      try {
        await ctx.answerCbQuery('❌ Balance မလုံလောက်ပါ သို့မဟုတ် order error ဖြစ်နေပါတယ်။', {
          show_alert: true,
        });
      } catch (_) {}
      return;
    }
  });

  bot.command('myorders', async (ctx) => {
    return replyHTML(ctx, await myOrdersText(ctx.from.id), replyOptions(ctx));
  });

  bot.command('shophelp', async (ctx) => {
    return replyHTML(ctx, helpText(), replyOptions(ctx));
  });

  bot.command('shopprices', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const prices = await getPriceMap();
    const lines = RARITIES.map((rarity) => (
      `${rarity.icon} <b>${rarity.label}</b>: <b>${fmt(prices[rarity.key])}</b> ${COIN}`
    )).join('\n');

    return replyHTML(ctx, `💰 <b>Shop Rarity Prices</b>\n━━━━━━━━━━━━━━━━\n${lines}`, replyOptions(ctx));
  });

  bot.command('setrarityprice', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const parts = String(ctx.message?.text || '').trim().split(/\s+/);
    const rarityKey = normalizeRarity(parts[1]);
    const amount = parseAmount(parts[2]);

    if (!rarityKey || !rarityInfo(rarityKey) || !amount || amount <= 0) {
      return replyHTML(
        ctx,
        `Usage: <code>/setrarityprice Divine 5000000</code>\n` +
          `Rarities: ${RARITIES.map((r) => r.label).join(', ')}`,
        replyOptions(ctx)
      );
    }

    const price = await setRarityPrice(rarityKey, amount);

    return replyHTML(
      ctx,
      `✅ <b>Rarity Price Updated</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Rarity: <b>${rarityLabel(rarityKey)}</b>\n` +
        `Price: <b>${fmt(price)}</b> ${COIN}`,
      replyOptions(ctx)
    );
  });

  bot.command('shopadd', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const parts = String(ctx.message?.text || '').trim().split(/\s+/);
    const rarityKey = normalizeRarity(parts[1]);
    const cardId = parts[2];
    const name = parts.slice(3).join(' ').trim();

    if (!rarityKey || !rarityInfo(rarityKey) || !cardId) {
      return replyHTML(
        ctx,
        `Usage: <code>/shopadd Divine D001</code>\n` +
          `Optional: <code>/shopadd Divine D001 Character Name</code>`,
        replyOptions(ctx)
      );
    }

    const now = new Date();

    await shopCardModel.collection().updateOne(
      { cardId: String(cardId) },
      {
        $setOnInsert: { cardId: String(cardId), createdAt: now },
        $set: {
          rarity: rarityKey,
          name: name || null,
          status: 'AVAILABLE',
          addedByUserId: ctx.from.id,
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    return replyHTML(
      ctx,
      `✅ <b>Card Added</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Rarity: <b>${rarityLabel(rarityKey)}</b>\n` +
        `Card ID: <code>${escHtml(cardId)}</code>\n` +
        `${name ? `Name: <b>${escHtml(name)}</b>` : ''}`,
      replyOptions(ctx)
    );
  });

  bot.command('shopbulk', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const parts = String(ctx.message?.text || '').trim().split(/\s+/);
    const rarityKey = normalizeRarity(parts[1]);
    const cardIds = parts.slice(2).filter(Boolean);

    if (!rarityKey || !rarityInfo(rarityKey) || !cardIds.length) {
      return replyHTML(ctx, `Usage: <code>/shopbulk Divine D001 D002 D003</code>`, replyOptions(ctx));
    }

    const now = new Date();

    const operations = cardIds.map((cardId) => ({
      updateOne: {
        filter: { cardId: String(cardId) },
        update: {
          $setOnInsert: { cardId: String(cardId), createdAt: now },
          $set: {
            rarity: rarityKey,
            name: null,
            status: 'AVAILABLE',
            addedByUserId: ctx.from.id,
            updatedAt: now,
          },
        },
        upsert: true,
      },
    }));

    await shopCardModel.collection().bulkWrite(operations, { ordered: false });

    return replyHTML(
      ctx,
      `✅ <b>Bulk Cards Added</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Rarity: <b>${rarityLabel(rarityKey)}</b>\n` +
        `Count: <b>${fmt(cardIds.length)}</b> cards`,
      replyOptions(ctx)
    );
  });

  bot.command('shopremove', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const cardId = String(ctx.message?.text || '').trim().split(/\s+/)[1];

    if (!cardId) {
      return replyHTML(ctx, 'Usage: <code>/shopremove D001</code>', replyOptions(ctx));
    }

    const result = await shopCardModel.collection().updateOne(
      { cardId },
      {
        $set: {
          status: 'REMOVED',
          removedByUserId: ctx.from.id,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      return replyHTML(ctx, '⚠️ Card ID မတွေ့ပါ။', replyOptions(ctx));
    }

    return replyHTML(
      ctx,
      `✅ <b>Card Removed</b>\n━━━━━━━━━━━━━━━━\nCard ID: <code>${escHtml(cardId)}</code>`,
      replyOptions(ctx)
    );
  });

  bot.command('shopcards', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const parts = String(ctx.message?.text || '').trim().split(/\s+/);
    const rarityKey = normalizeRarity(parts[1]);

    const query = rarityKey ? { rarity: rarityKey, status: 'AVAILABLE' } : { status: 'AVAILABLE' };

    const cards = await shopCardModel.collection()
      .find(query)
      .sort({ rarity: 1, cardId: 1 })
      .limit(50)
      .toArray();

    if (!cards.length) {
      return replyHTML(ctx, '📦 Available card မရှိသေးပါ။', replyOptions(ctx));
    }

    const lines = cards.map((card, index) => (
      `${index + 1}. ${rarityLabel(card.rarity)} — <code>${escHtml(card.cardId)}</code>${card.name ? ` — ${escHtml(card.name)}` : ''}`
    )).join('\n');

    return replyHTML(ctx, `🎴 <b>Available Shop Cards</b>\n━━━━━━━━━━━━━━━━\n${lines}`, replyOptions(ctx));
  });
};

module.exports.RARITIES = RARITIES;
