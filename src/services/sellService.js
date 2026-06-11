'use strict';

const { getDb, col } = require('../config/database');
const {
  getBotConfig,
  getRarityConfig,
  resolveBotKey,
  resolveRarityKey,
} = require('../config/sellCatalog');

let indexesPromise = null;

function ordersCol() {
  return getDb().collection('sell_orders');
}

function pricesCol() {
  return getDb().collection('sell_prices');
}

async function safeCreateIndex(collection, keys, options = {}) {
  try {
    return await collection.createIndex(keys, options);
  } catch (err) {
    if ([85, 86].includes(err?.code) || ['IndexOptionsConflict', 'IndexKeySpecsConflict'].includes(err?.codeName)) {
      return null;
    }
    throw err;
  }
}

async function ensureSellIndexes() {
  if (!indexesPromise) {
    indexesPromise = (async () => {
      const orders = ordersCol();
      const prices = pricesCol();

      await safeCreateIndex(orders, { orderId: 1 }, { unique: true, name: 'orderId_1' });
      await safeCreateIndex(orders, { giftLink: 1 }, { unique: true, name: 'giftLink_1' });
      await safeCreateIndex(orders, { sellerId: 1, createdAt: -1 }, { name: 'sellerId_1_createdAt_-1' });
      await safeCreateIndex(orders, { status: 1, createdAt: -1 }, { name: 'status_1_createdAt_-1' });

      await safeCreateIndex(prices, { botKey: 1, rarityKey: 1 }, { unique: true, name: 'botKey_1_rarityKey_1' });
    })();
  }

  return indexesPromise;
}

function parsePositivePrice(input) {
  const price = Number(String(input || '').replace(/,/g, '').trim());

  if (!Number.isInteger(price) || price < 0) {
    throw new Error('PRICE_INVALID');
  }

  return price;
}

function getOwnerIds() {
  return String(process.env.OWNER_IDS || process.env.OWNER_ID || '')
    .split(',')
    .map((id) => Number(String(id).trim()))
    .filter(Boolean);
}

function isOwner(userId) {
  return getOwnerIds().includes(Number(userId));
}

function isTelegramGiftLink(text) {
  const value = String(text || '').trim();
  return /^https?:\/\/t\.me\/[A-Za-z0-9_]+\/\d+(?:\?.*)?$/i.test(value);
}

function normalizeGiftLink(text) {
  return String(text || '').trim().replace(/\/+$/, '');
}

function createOrderId() {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SELL-${stamp}-${rand}`;
}

function createReceipt() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `RCPT-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

async function getPrice(botKey, rarityKey) {
  await ensureSellIndexes();

  const bot = getBotConfig(botKey);
  const rarity = getRarityConfig(botKey, rarityKey);

  if (!bot || !rarity) return null;

  const custom = await pricesCol().findOne({
    botKey: bot.key,
    rarityKey: rarity.key,
  });

  const price = Number.isFinite(Number(custom?.price))
    ? Number(custom.price)
    : Number(rarity.defaultPrice);

  return {
    botKey: bot.key,
    botName: bot.name,
    rarityKey: rarity.key,
    rarityName: rarity.name,
    rarityLabel: rarity.label,
    price,
    isCustom: Boolean(custom),
  };
}

async function setPrice(botInput, rarityInput, priceInput, ownerId) {
  await ensureSellIndexes();

  const botKey = resolveBotKey(botInput);
  if (!botKey) throw new Error('BOT_NOT_FOUND');

  const rarityKey = resolveRarityKey(botKey, rarityInput);
  if (!rarityKey) throw new Error('RARITY_NOT_FOUND');

  const price = parsePositivePrice(priceInput);
  const priceInfo = await getPrice(botKey, rarityKey);
  if (!priceInfo) throw new Error('PRICE_TARGET_NOT_FOUND');

  const now = new Date();

  await pricesCol().updateOne(
    { botKey, rarityKey },
    {
      $set: {
        botKey,
        botName: priceInfo.botName,
        rarityKey,
        rarityName: priceInfo.rarityName,
        rarityLabel: priceInfo.rarityLabel,
        price,
        updatedBy: Number(ownerId),
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  return {
    ...priceInfo,
    price,
    isCustom: true,
  };
}

async function createSellOrder({ seller, botKey, rarityKey, giftLink }) {
  await ensureSellIndexes();

  const priceInfo = await getPrice(botKey, rarityKey);
  if (!priceInfo) throw new Error('PRICE_NOT_FOUND');

  const normalizedGiftLink = normalizeGiftLink(giftLink);
  if (!isTelegramGiftLink(normalizedGiftLink)) throw new Error('GIFT_LINK_INVALID');

  const now = new Date();
  const order = {
    orderId: createOrderId(),
    receipt: createReceipt(),
    sellerId: Number(seller.id),
    sellerUsername: seller.username || null,
    sellerName: [seller.first_name, seller.last_name].filter(Boolean).join(' ') || null,
    botKey: priceInfo.botKey,
    botName: priceInfo.botName,
    rarityKey: priceInfo.rarityKey,
    rarityName: priceInfo.rarityName,
    rarityLabel: priceInfo.rarityLabel,
    giftLink: normalizedGiftLink,
    price: priceInfo.price,
    status: 'PENDING',
    ownerAlertSent: false,
    ownerAlerts: [],
    createdAt: now,
    updatedAt: now,
    approvedAt: null,
    approvedBy: null,
    cancelledAt: null,
    cancelledBy: null,
  };

  try {
    await ordersCol().insertOne(order);
    return order;
  } catch (err) {
    if (err?.code === 11000) throw new Error('DUPLICATE_GIFT_LINK');
    throw err;
  }
}

async function markOwnerAlert(orderId, alerts) {
  await ensureSellIndexes();

  await ordersCol().updateOne(
    { orderId },
    {
      $set: {
        ownerAlertSent: alerts.length > 0,
        ownerAlerts: alerts,
        updatedAt: new Date(),
      },
    }
  );
}

async function getOrder(orderId) {
  await ensureSellIndexes();
  return ordersCol().findOne({ orderId: String(orderId) });
}

async function listSellerOrders(sellerId, limit = 10) {
  await ensureSellIndexes();

  return ordersCol()
    .find({ sellerId: Number(sellerId) })
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(20, Number(limit) || 10)))
    .toArray();
}

async function creditSellerBalance(order, ownerId) {
  const users = col('users');
  const transactions = col('transactions');
  const now = new Date();

  const userUpdate = await users.updateOne(
    { userId: Number(order.sellerId) },
    {
      $inc: { balance: Number(order.price) },
      $set: { updatedAt: now },
    }
  );

  if (userUpdate.matchedCount !== 1) {
    throw new Error('SELLER_USER_NOT_FOUND');
  }

  await transactions.insertOne({
    userId: Number(order.sellerId),
    amount: Number(order.price),
    type: 'sell_card_approved',
    direction: 'credit',
    orderId: order.orderId,
    receipt: order.receipt,
    botKey: order.botKey,
    botName: order.botName,
    rarityKey: order.rarityKey,
    rarityName: order.rarityName,
    giftLink: order.giftLink,
    approvedBy: Number(ownerId),
    createdAt: now,
  });
}

async function approveOrder(orderId, ownerId) {
  await ensureSellIndexes();

  const now = new Date();
  const lock = await ordersCol().updateOne(
    { orderId: String(orderId), status: 'PENDING' },
    {
      $set: {
        status: 'APPROVING',
        approvedBy: Number(ownerId),
        updatedAt: now,
      },
    }
  );

  if (lock.modifiedCount !== 1) {
    const current = await getOrder(orderId);
    return {
      ok: false,
      reason: current ? `ORDER_ALREADY_${current.status}` : 'ORDER_NOT_FOUND',
      order: current,
    };
  }

  const order = await getOrder(orderId);

  try {
    await creditSellerBalance(order, ownerId);
  } catch (err) {
    await ordersCol().updateOne(
      { orderId: String(orderId), status: 'APPROVING' },
      {
        $set: {
          status: 'PENDING',
          lastError: err?.message || String(err),
          updatedAt: new Date(),
        },
      }
    );
    throw err;
  }

  await ordersCol().updateOne(
    { orderId: String(orderId), status: 'APPROVING' },
    {
      $set: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy: Number(ownerId),
        updatedAt: new Date(),
      },
    }
  );

  return {
    ok: true,
    order: await getOrder(orderId),
  };
}

async function cancelOrder(orderId, ownerId) {
  await ensureSellIndexes();

  const now = new Date();
  const res = await ordersCol().updateOne(
    { orderId: String(orderId), status: 'PENDING' },
    {
      $set: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledBy: Number(ownerId),
        updatedAt: now,
      },
    }
  );

  const order = await getOrder(orderId);

  if (res.modifiedCount !== 1) {
    return {
      ok: false,
      reason: order ? `ORDER_ALREADY_${order.status}` : 'ORDER_NOT_FOUND',
      order,
    };
  }

  return {
    ok: true,
    order,
  };
}

module.exports = {
  ensureSellIndexes,
  getOwnerIds,
  isOwner,
  isTelegramGiftLink,
  normalizeGiftLink,
  getPrice,
  setPrice,
  createSellOrder,
  markOwnerAlert,
  getOrder,
  listSellerOrders,
  approveOrder,
  cancelOrder,
};
