import { db, EndpointError } from 'sdk';
import { and, asc, desc, eq } from 'sdk/db';
import { orders, shopCards, sellOrders, sellPrices, users } from '../schema.js';
import { ensureEconomy, ensureUser, userById, recordLedgerOperation, credit, getSetting, setSetting } from './economy.js';
import { getShopEnabled } from './eventMarkets.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';

const now = () => new Date();
const random = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const keyText = (value, max = 64) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, max);
function ownerOnly(actorId) {
  const expected = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  if (!Number.isSafeInteger(expected) || expected <= 0) {
    throw new EndpointError('SERVERLESS_OWNER_TELEGRAM_ID ကို config မှာ သတ်မှတ်ပေးပါ။', { code: 'OWNER_NOT_CONFIGURED' });
  }
  if (String(actorId ?? '') !== String(expected)) throw new EndpointError('Owner only.', { code: 'OWNER_ONLY' });
}
function whole(value, minimum = 0, maximum = 1000000000000) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isSafeInteger(n) || n < minimum || n > maximum) {
    throw new EndpointError('Amount/price မမှန်ပါ။', { code: 'COMMERCE_AMOUNT_INVALID' });
  }
  return n;
}
function receipt(prefix) {
  return prefix + '-' + Date.now().toString(36).toUpperCase() + '-' + random();
}
function shopOpenBypass(userId) {
  const owner = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  return Number.isSafeInteger(owner) && owner > 0 && String(userId) === String(owner);
}
async function isSellEnabled() {
  const value = await getSetting('sell_system_enabled', true);
  return typeof value === 'object' && value !== null ? value.enabled !== false : value !== false;
}

export async function addShopCard({ actorId, botKey, cardId, rarity, price, name, anime = null, mediaUrl = null }) {
  await ensureEconomy();
  ownerOnly(actorId);
  const bot = keyText(botKey), card = String(cardId ?? '').trim().slice(0, 120), tier = keyText(rarity);
  const cost = whole(price);
  if (!bot || !card || !tier) throw new EndpointError('Usage: /shopstock <bot> <cardId> <rarity> <price> <name>', { code: 'SHOP_STOCK_INVALID' });
  const stamp = now();
  try {
    await db.insert(shopCards).values({
      botKey: bot, cardId: card, name: String(name || card).trim().slice(0, 160),
      anime: anime ? String(anime).trim().slice(0, 160) : null,
      rarity: tier, mediaUrl: mediaUrl ? String(mediaUrl).slice(0, 1000) : null,
      ownerUserId: null, status: 'AVAILABLE', price: cost, soldToUserId: null, soldAt: null,
      data: { stockedBy: Number(actorId) }, createdAt: stamp, updatedAt: stamp,
    }).run();
  } catch (error) {
    if (/unique|constraint|already exists/i.test(String(error?.message || error))) {
      throw new EndpointError('ဒီ bot/card ID နဲ့ stock ရှိပြီးသားပါ။', { code: 'SHOP_CARD_DUPLICATE' });
    }
    throw error;
  }
  return { ok: true, botKey: bot, cardId: card, rarity: tier, price: cost };
}

export async function listAvailableShopCards(limit = 25) {
  await ensureEconomy();
  return db.select().from(shopCards).where(eq(shopCards.status, 'AVAILABLE'))
    .orderBy(asc(shopCards.id)).limit(Math.max(1, Math.min(50, Number(limit) || 25))).all();
}
export async function getShopCard(cardId) {
  await ensureEconomy();
  const id = whole(cardId, 1, Number.MAX_SAFE_INTEGER);
  return db.select().from(shopCards).where(eq(shopCards.id, id)).get();
}
export async function createShopOrder({ telegramUser, cardId, requestKey }) {
  await ensureEconomy();
  const user = await ensureUser(telegramUser);
  if (user.isBanned) throw new EndpointError('ဒီ account ကို shop မှာ အသုံးပြုခွင့်မရှိပါ။', { code: 'USER_BANNED' });
  if (!(await getShopEnabled()) && !shopOpenBypass(user.tgId)) throw new EndpointError('Shop System ပိတ်ထားပါတယ်။', { code: 'SHOP_DISABLED' });
  const card = await getShopCard(cardId);
  if (!card || card.status !== 'AVAILABLE') throw new EndpointError('ဒီ card ကို ဝယ်ယူလို့မရတော့ပါ။', { code: 'SHOP_CARD_UNAVAILABLE' });
  const cost = whole(card.price, 1);
  const orderId = 'ord-' + Date.now().toString(36) + '-' + random().toLowerCase();
  const receiptCode = receipt('BIKA');
  const request = String(requestKey || orderId).trim().slice(0, 80);
  const ledgerKey = 'shop-buy:' + user.tgId + ':' + card.id + ':' + request;
  const operation = await recordLedgerOperation({
    type: 'shop_purchase', fromUserId: String(user.tgId), toUserId: 'TREASURY',
    amount: cost, accountUserId: user.tgId, balanceDelta: -cost, requiredBalance: cost,
    totalWonDelta: 0, totalLostDelta: 0, treasuryDelta: cost, requiredTreasury: 0,
    idempotencyKey: ledgerKey,
    meta: { shopCardId: Number(card.id), orderId, receiptCode, botKey: card.botKey, cardId: card.cardId,
      name: card.name, anime: card.anime, rarity: card.rarity, source: 'telegram_shop' },
  });
  const storedOrderId = String(operation.row?.meta?.orderId || orderId);
  const order = await db.select().from(orders).where(eq(orders.id, storedOrderId)).get();
  if (!order) throw new EndpointError('Order ကို ledger ထဲမှာ တွေ့ပေမယ့် order record မတွေ့ပါ။ Owner က /shoporders နဲ့ စစ်ပါ။', { code: 'SHOP_ORDER_RECONCILIATION_REQUIRED' });
  return { ok: true, duplicate: operation.duplicate, card, order, balance: Number((await userById(user.tgId))?.balance || 0) };
}

export async function listUserShopOrders(userId, limit = 10) {
  await ensureEconomy();
  return db.select().from(orders).where(eq(orders.userId, Number(userId)))
    .orderBy(desc(orders.createdAt)).limit(Math.max(1, Math.min(20, Number(limit) || 10))).all();
}
export async function listUserInventory(userId, limit = 50) {
  await ensureEconomy();
  return db.select().from(shopCards).where(eq(shopCards.ownerUserId, Number(userId)))
    .orderBy(desc(shopCards.soldAt)).limit(Math.max(1, Math.min(100, Number(limit) || 50))).all();
}
export async function listPendingShopOrders(limit = 20) {
  await ensureEconomy();
  return db.select().from(orders).where(eq(orders.status, 'pending'))
    .orderBy(asc(orders.createdAt)).limit(Math.max(1, Math.min(50, Number(limit) || 20))).all();
}

export async function approveShopOrder({ actorId, orderId }) {
  await ensureEconomy();
  ownerOnly(actorId);
  const id = String(orderId || '');
  let order = await db.select().from(orders).where(eq(orders.id, id)).get();
  if (!order) throw new EndpointError('Shop order မတွေ့ပါ။', { code: 'SHOP_ORDER_NOT_FOUND' });
  if (order.status === 'cancelled' || order.status === 'cancelling') throw new EndpointError('Cancel လုပ်နေသော order ကို approve မလုပ်နိုင်ပါ။', { code: 'SHOP_ORDER_STATE' });
  if (order.status === 'pending') {
    await db.update(orders).set({ status: 'approving', updatedAt: now() })
      .where(and(eq(orders.id, id), eq(orders.status, 'pending'))).run();
  } else if (!['approving', 'completed'].includes(order.status)) {
    throw new EndpointError('Shop order state မမှန်ပါ။', { code: 'SHOP_ORDER_STATE' });
  }
  order = await db.select().from(orders).where(eq(orders.id, id)).get();
  const cardId = Number(order.itemId);
  const card = await db.select().from(shopCards).where(eq(shopCards.id, cardId)).get();
  if (!card) throw new EndpointError('Stock card မတွေ့ပါ။', { code: 'SHOP_CARD_NOT_FOUND' });
  if (card.status === 'SOLD' && Number(card.soldToUserId) === Number(order.userId)) {
    // Recover if a prior invocation updated the card but not the order.
  } else if (card.status === 'PENDING') {
    await db.update(shopCards).set({
      status: 'SOLD', ownerUserId: Number(order.userId), soldToUserId: Number(order.userId),
      soldAt: now(), updatedAt: now(),
    }).where(and(eq(shopCards.id, cardId), eq(shopCards.status, 'PENDING'))).run();
  } else {
    throw new EndpointError('Card ကို အခြား order က ပြောင်းလဲထားပါတယ်။', { code: 'SHOP_CARD_STATE_CONFLICT' });
  }
  await db.update(orders).set({ status: 'completed', updatedAt: now() }).where(eq(orders.id, id)).run();
  return { ok: true, duplicate: order.status === 'completed', order: await db.select().from(orders).where(eq(orders.id, id)).get(), card: await getShopCard(cardId) };
}

export async function cancelShopOrder({ actorId, orderId }) {
  await ensureEconomy();
  ownerOnly(actorId);
  const id = String(orderId || '');
  let order = await db.select().from(orders).where(eq(orders.id, id)).get();
  if (!order) throw new EndpointError('Shop order မတွေ့ပါ။', { code: 'SHOP_ORDER_NOT_FOUND' });
  if (order.status === 'completed' || order.status === 'approving') throw new EndpointError('Approve ဖြစ်နေသော order ကို refund/cancel မလုပ်နိုင်ပါ။', { code: 'SHOP_ORDER_STATE' });
  if (order.status === 'cancelled') return { ok: true, duplicate: true, order };
  if (order.status === 'pending') {
    await db.update(orders).set({ status: 'cancelling', updatedAt: now() })
      .where(and(eq(orders.id, id), eq(orders.status, 'pending'))).run();
  } else if (order.status !== 'cancelling') {
    throw new EndpointError('Shop order state မမှန်ပါ။', { code: 'SHOP_ORDER_STATE' });
  }
  order = await db.select().from(orders).where(eq(orders.id, id)).get();
  await credit(Number(order.userId), Number(order.amount), 'shop_refund', { orderId: id, receiptCode: order.receiptCode }, 'shop-refund:' + id);
  const cardId = Number(order.itemId);
  const card = await db.select().from(shopCards).where(eq(shopCards.id, cardId)).get();
  if (card?.status === 'PENDING') {
    await db.update(shopCards).set({ status: 'AVAILABLE', ownerUserId: null, soldToUserId: null, soldAt: null, updatedAt: now() })
      .where(and(eq(shopCards.id, cardId), eq(shopCards.status, 'PENDING'))).run();
  } else if (card && card.status !== 'AVAILABLE') {
    throw new EndpointError('Card status ကို အတည်မပြုနိုင်ပါ။ Order ကို review လုပ်ပါ။', { code: 'SHOP_CARD_STATE_CONFLICT' });
  }
  await db.update(orders).set({ status: 'cancelled', updatedAt: now() }).where(eq(orders.id, id)).run();
  return { ok: true, duplicate: false, order: await db.select().from(orders).where(eq(orders.id, id)).get() };
}

// Main-branch /sell is a separate Telegram Gift-link sell-to-owner process.
export async function setSellPrice({ actorId, botKey, rarity, price }) {
  await ensureEconomy();
  ownerOnly(actorId);
  const bot = keyText(botKey), tier = keyText(rarity), amount = whole(price);
  if (!bot || !tier) throw new EndpointError('Usage: /sellpriceadd <bot> <rarity> <price>', { code: 'SELL_PRICE_INVALID' });
  const key = bot + ':' + tier;
  await db.insert(sellPrices).values({ key, price: amount, updatedAt: now() })
    .onConflictDoUpdate({ target: sellPrices.key, set: { price: amount, updatedAt: now() } }).run();
  return { ok: true, key, botKey: bot, rarity: tier, price: amount };
}
export async function getSellPrice(botKey, rarity) {
  await ensureEconomy();
  const key = keyText(botKey) + ':' + keyText(rarity);
  return db.select().from(sellPrices).where(eq(sellPrices.key, key)).get();
}
function validateGiftLink(value) {
  const link = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/t\.me\/[A-Za-z0-9_]+\/\d+(?:\?.*)?$/i.test(link)) {
    throw new EndpointError('Telegram message link မမှန်ပါ။', { code: 'GIFT_LINK_INVALID' });
  }
  return link;
}
export async function createSellOrder({ seller, botKey, rarity, giftLink }) {
  await ensureEconomy();
  const user = await ensureUser(seller);
  if (user.isBanned) throw new EndpointError('ဒီ account ကို sell system မှာ အသုံးပြုခွင့်မရှိပါ။', { code: 'USER_BANNED' });
  if (!(await isSellEnabled()) && !shopOpenBypass(user.tgId)) throw new EndpointError('Sell System ပိတ်ထားပါတယ်။', { code: 'SELL_DISABLED' });
  const price = await getSellPrice(botKey, rarity);
  if (!price) throw new EndpointError('Sell price မသတ်မှတ်ရသေးပါ။', { code: 'SELL_PRICE_NOT_FOUND' });
  const link = validateGiftLink(giftLink);
  const orderId = 'sell-' + Date.now().toString(36) + '-' + random().toLowerCase();
  const stamp = now();
  const row = {
    id: orderId, sellerId: user.tgId, buyerId: null, status: 'pending', price: Number(price.price),
    receiptCode: receipt('SELL'), data: { botKey: keyText(botKey), rarity: keyText(rarity), giftLink: link, sellerName: user.firstName, username: user.username },
    createdAt: stamp, updatedAt: stamp,
  };
  await db.insert(sellOrders).values(row).run();
  return { ok: true, order: row };
}
export async function listSellOrders({ userId = null, pendingOnly = false, limit = 20 } = {}) {
  await ensureEconomy();
  let rows = await db.select().from(sellOrders).orderBy(desc(sellOrders.createdAt))
    .limit(Math.max(1, Math.min(50, Number(limit) || 20))).all();
  if (pendingOnly) rows = rows.filter(row => ['pending', 'approving'].includes(row.status));
  if (userId != null) rows = rows.filter(row => Number(row.sellerId) === Number(userId));
  return rows;
}
export async function approveSellOrder({ actorId, orderId }) {
  await ensureEconomy();
  ownerOnly(actorId);
  const id = String(orderId || '');
  let order = await db.select().from(sellOrders).where(eq(sellOrders.id, id)).get();
  if (!order) throw new EndpointError('Sell order မတွေ့ပါ။', { code: 'SELL_ORDER_NOT_FOUND' });
  if (order.status === 'cancelled') throw new EndpointError('Cancel ဖြစ်ပြီးသား order ကို approve မလုပ်နိုင်ပါ။', { code: 'SELL_ORDER_STATE' });
  if (order.status === 'pending') {
    await db.update(sellOrders).set({ status: 'approving', updatedAt: now() })
      .where(and(eq(sellOrders.id, id), eq(sellOrders.status, 'pending'))).run();
  } else if (!['approving', 'approved'].includes(order.status)) {
    throw new EndpointError('Sell order state မမှန်ပါ။', { code: 'SELL_ORDER_STATE' });
  }
  order = await db.select().from(sellOrders).where(eq(sellOrders.id, id)).get();
  if (Number(order.price) > 0) {
    await credit(Number(order.sellerId), Number(order.price), 'sell_order_payout',
      { orderId: id, receiptCode: order.receiptCode, ...(order.data || {}) }, 'sell-payout:' + id);
  }
  await db.update(sellOrders).set({ status: 'approved', updatedAt: now() }).where(eq(sellOrders.id, id)).run();
  return { ok: true, duplicate: order.status === 'approved', order: await db.select().from(sellOrders).where(eq(sellOrders.id, id)).get() };
}
export async function cancelSellOrder({ actorId, orderId }) {
  await ensureEconomy();
  ownerOnly(actorId);
  const id = String(orderId || '');
  const order = await db.select().from(sellOrders).where(eq(sellOrders.id, id)).get();
  if (!order) throw new EndpointError('Sell order မတွေ့ပါ။', { code: 'SELL_ORDER_NOT_FOUND' });
  if (order.status === 'approved' || order.status === 'approving') throw new EndpointError('Approve ဖြစ်နေသော order ကို cancel မလုပ်နိုင်ပါ။', { code: 'SELL_ORDER_STATE' });
  if (order.status === 'cancelled') return { ok: true, duplicate: true, order };
  await db.update(sellOrders).set({ status: 'cancelled', updatedAt: now() })
    .where(and(eq(sellOrders.id, id), eq(sellOrders.status, 'pending'))).run();
  return { ok: true, duplicate: false, order: await db.select().from(sellOrders).where(eq(sellOrders.id, id)).get() };
}
