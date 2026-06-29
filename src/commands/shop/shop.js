'use strict';

const { ObjectId } = require('mongodb');
const { COIN } = require('../../config/constants');
const { getBotInfo } = require('../../config/bot');
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
const { replyHTML, editHTML, editByIds } = require('../../utils/telegram');
const { fmt, escHtml } = require('../../utils/format');
const { mentionHtml } = require('../../utils/helpers');

const pendingOrders = new Map();

const ORDER_TIMEOUT_MS = Number(process.env.SHOP_CONFIRM_TIMEOUT_MS || 60_000);
const MAX_PENDING_ORDERS = Number(process.env.SHOP_MAX_PENDING || 10_000);
const SHOP_ENABLED_SETTING_KEY = 'shop_enabled';
const SHOP_OFF_TEXT = '⛔ <b>Shop System ပိတ်ထားပါတယ်။</b>';

const DEFAULT_RARITIES = Object.freeze([
  Object.freeze({ key: 'uncommon', label: 'Uncommon', icon: '🟣', defaultPrice: 50_000 }),
  Object.freeze({ key: 'rare', label: 'Rare', icon: '🔵', defaultPrice: 100_000 }),
  Object.freeze({ key: 'legendary', label: 'Legendary', icon: '🟡', defaultPrice: 1_000_000 }),
  Object.freeze({ key: 'mystical', label: 'Mystical', icon: '💮', defaultPrice: 2_500_000 }),
  Object.freeze({ key: 'divine', label: 'Divine', icon: '⚜️', defaultPrice: 5_000_000 }),
  Object.freeze({ key: 'crossverse', label: 'CrossVerse', icon: '⚡', defaultPrice: 10_000_000 }),
  Object.freeze({ key: 'cataphract', label: 'Cataphract', icon: '✨', defaultPrice: 25_000_000 }),
  Object.freeze({ key: 'supreme', label: 'Supreme', icon: '🪞', defaultPrice: 50_000_000 }),
]);

const HALLOW_RARITIES = Object.freeze([
  Object.freeze({ key: 'common', label: 'Common', icon: '🔵', defaultPrice: 25_000 }),
  Object.freeze({ key: 'uncommon', label: 'Uncommon', icon: '🟣', defaultPrice: 50_000 }),
  Object.freeze({ key: 'rare', label: 'Rare', icon: '🟠', defaultPrice: 100_000 }),
  Object.freeze({ key: 'legendary', label: 'Legendary', icon: '🟡', defaultPrice: 1_000_000 }),
  Object.freeze({ key: 'eldritch', label: 'Eldritch', icon: '💮', defaultPrice: 2_500_000 }),
  Object.freeze({ key: 'oblivion', label: 'Oblivion', icon: '⚜️', defaultPrice: 5_000_000 }),
  Object.freeze({ key: 'crossverse', label: 'Crossverse', icon: '⚡', defaultPrice: 10_000_000 }),
  Object.freeze({ key: 'cataclysmic', label: 'Cataclysmic', icon: '🎐', defaultPrice: 25_000_000 }),
  Object.freeze({ key: 'abyssion', label: 'Abyssion', icon: '🎴', defaultPrice: 50_000_000 }),
]);

const RARITIES = Object.freeze([
  ...DEFAULT_RARITIES,
  ...HALLOW_RARITIES.filter((rarity) => !DEFAULT_RARITIES.some((item) => item.key === rarity.key)),
]);

const SHOP_BOTS = Object.freeze([
  Object.freeze({ key: 'catchbot', label: 'CatchBot', icon: '🎯' }),
  Object.freeze({ key: 'bikabot', label: 'BikaBot', icon: '🤖' }),
  Object.freeze({ key: 'hallowbot', label: 'HallowBot', icon: '🎃' }),
]);

function normalizeShopBot(input) {
  const raw = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[\s_-]+/g, '');

  if (!raw) return null;

  const aliases = {
    charactercatcherbot: 'catchbot',
    catchbot: 'catchbot',
    catch: 'catchbot',
    catcher: 'catchbot',

    bikacharacterbot: 'bikabot',
    bikabot: 'bikabot',
    bika: 'bikabot',

    charactershallowbot: 'hallowbot',
    characterhallowbot: 'hallowbot',
    hallowbot: 'hallowbot',
    hallow: 'hallowbot',
    halloween: 'hallowbot',
  };

  return aliases[raw] || null;
}

function sourceBotFromMessage(message) {
  const username =
    message?.via_bot?.username ||
    message?.forward_from?.username ||
    message?.from?.username ||
    '';

  return {
    botKey: normalizeShopBot(username),
    username: username || null,
  };
}

function shopBotInfo(key) {
  return SHOP_BOTS.find((bot) => bot.key === key) || null;
}

function shopBotLabel(key) {
  const info = shopBotInfo(key);
  return info ? `${info.icon} ${info.label}` : '🤖 BikaBot';
}

function getBotRarities(botKey) {
  return normalizeShopBot(botKey) === 'hallowbot' ? HALLOW_RARITIES : DEFAULT_RARITIES;
}

function cardBotKey(card) {
  return normalizeShopBot(card?.botKey || card?.sourceBot || card?.shopBot) || 'bikabot';
}

function shopBotFilter(botKey) {
  const key = normalizeShopBot(botKey) || 'bikabot';

  if (key === 'bikabot') {
    return {
      $or: [
        { botKey: key },
        { sourceBot: key },
        { shopBot: key },
        {
          botKey: { $exists: false },
          sourceBot: { $exists: false },
          shopBot: { $exists: false },
        },
      ],
    };
  }

  return {
    $or: [
      { botKey: key },
      { sourceBot: key },
      { shopBot: key },
    ],
  };
}

function parseBotAndRarity(parts, startIndex = 1) {
  const maybeBot = normalizeShopBot(parts[startIndex]);

  if (maybeBot) {
    return {
      botKey: maybeBot,
      rarityKey: normalizeRarity(parts[startIndex + 1]),
      nextIndex: startIndex + 2,
    };
  }

  return {
    botKey: 'bikabot',
    rarityKey: normalizeRarity(parts[startIndex]),
    nextIndex: startIndex + 1,
  };
}

function primaryButton(text, callbackData) {
  return { text, callback_data: callbackData, style: 'primary' };
}

function successButton(text, callbackData) {
  return { text, callback_data: callbackData, style: 'success' };
}

function dangerButton(text, callbackData) {
  return { text, callback_data: callbackData, style: 'danger' };
}

function normalizeRarity(input) {
  const raw = String(input || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!raw) return null;

  const aliases = {
    common: 'common',
    uncommon: 'uncommon',
    rare: 'rare',
    legendary: 'legendary',
    mystical: 'mystical',
    divine: 'divine',
    eldritch: 'eldritch',
    oblivion: 'oblivion',
    crossverse: 'crossverse',
    cross: 'crossverse',
    cataphract: 'cataphract',
    cata: 'cataphract',
    cataclysmic: 'cataclysmic',
    abyssion: 'abyssion',
    abyss: 'abyssion',
    supreme: 'supreme',
  };

  return aliases[raw] || null;
}

function rarityInfo(key, botKey = null) {
  const list = botKey ? getBotRarities(botKey) : RARITIES;
  return list.find((rarity) => rarity.key === key) || null;
}

function rarityLabel(key, botKey = null) {
  const info = rarityInfo(key, botKey);
  return info ? `${info.icon} ${info.label}` : escHtml(String(key || 'Unknown'));
}

function privateOnly(ctx) {
  return ctx.chat?.type === 'private';
}

function getBotUsername(ctx, targetBot) {
  return (
    getBotInfo()?.username ||
    ctx.botInfo?.username ||
    targetBot?.botInfo?.username ||
    process.env.BOT_USERNAME ||
    ''
  );
}

function dmOnlyKeyboard(ctx, targetBot) {
  const username = getBotUsername(ctx, targetBot);

  if (!username) {
    return undefined;
  }

  return {
    inline_keyboard: [[
      {
        text: 'Go to DM',
        url: `https://t.me/${username}?start=shop`,
        style: 'primary',
      },
    ]],
  };
}

function dmOnlyText() {
  return (
    'ℹ️ <b>This command is only use in DM.</b>\n\n' +
    'Please open bot DM and use <code>/shop</code> there.'
  );
}

async function requireShopDm(ctx, targetBot = null, mode = 'message') {
  if (privateOnly(ctx)) return true;

  if (mode === 'callback') {
    try {
      await ctx.answerCbQuery('Shop ကို bot DM ထဲမှာပဲ သုံးပါ။', { show_alert: true });
    } catch (_) {}

    return false;
  }

  await replyHTML(ctx, dmOnlyText(), {
    ...replyOptions(ctx),
    reply_markup: dmOnlyKeyboard(ctx, targetBot),
  });

  return false;
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

async function editOrderMessage(bot, chatId, messageId, html, hasMedia = false, extra = {}) {
  if (hasMedia) {
    try {
      return await bot.telegram.editMessageCaption(chatId, messageId, undefined, html, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        ...extra,
      });
    } catch (err) {
      const message = String(err?.message || err);

      if (
        message.includes('message is not modified') ||
        message.includes('message to edit not found') ||
        message.includes('there is no caption in the message to edit')
      ) {
        return null;
      }

      return null;
    }
  }

  return editByIds(bot, chatId, messageId, html, extra);
}

async function deleteCallbackMessage(ctx) {
  try {
    const messageId = ctx.callbackQuery?.message?.message_id;
    if (messageId) {
      await ctx.deleteMessage(messageId);
    }
  } catch (_) {}
}


function buttonOwnerId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

async function requireButtonOwner(ctx, ownerId) {
  const expected = buttonOwnerId(ownerId);

  if (!expected) {
    try {
      await ctx.answerCbQuery('Invalid shop button.', { show_alert: true });
    } catch (_) {}

    return false;
  }

  if (ctx.from?.id !== expected) {
    try {
      await ctx.answerCbQuery('ဒီ shop button ကို သက်ဆိုင်တဲ့သူပဲနှိပ်နိုင်ပါတယ်။', {
        show_alert: true,
      });
    } catch (_) {}

    return false;
  }

  return true;
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

async function getShopEnabled() {
  const doc = await shopSettingModel.collection().findOne({ key: SHOP_ENABLED_SETTING_KEY });
  return doc?.enabled !== false;
}

async function setShopEnabled(enabled, updatedByUserId) {
  const now = new Date();

  await shopSettingModel.collection().updateOne(
    { key: SHOP_ENABLED_SETTING_KEY },
    {
      $set: {
        key: SHOP_ENABLED_SETTING_KEY,
        enabled: !!enabled,
        updatedByUserId: updatedByUserId || null,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true }
  );

  return !!enabled;
}

async function requireShopOpen(ctx, mode = 'message') {
  const treasury = await ensureTreasury();
  const owner = isOwner(ctx, treasury);

  if (owner || await getShopEnabled()) {
    return true;
  }

  if (mode === 'callback') {
    try {
      await ctx.answerCbQuery('Shop System ပိတ်ထားပါတယ်။', { show_alert: true });
    } catch (_) {}

    return false;
  }

  await replyHTML(ctx, SHOP_OFF_TEXT, replyOptions(ctx));
  return false;
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

async function countAvailableByRarity(botKey = 'bikabot') {
  const counts = {};
  for (const rarity of getBotRarities(botKey)) counts[rarity.key] = 0;

  const docs = await shopCardModel.collection()
    .aggregate([
      { $match: { status: 'AVAILABLE', ...shopBotFilter(botKey) } },
      { $group: { _id: '$rarity', count: { $sum: 1 } } },
    ])
    .toArray();

  for (const doc of docs) {
    if (doc?._id) counts[doc._id] = doc.count || 0;
  }

  return counts;
}

function shopHomeText(balance) {
  return (
    `🎁 <b>Bika Game Coin To Card Exchange</b>
` +
    `━━━━━━━━━━━━━━━━
` +
    `Game ဆော့တဲ့ player တွေအတွက် card လက်ဆောင်တွေကို ${COIN} နဲ့ လဲလှယ်နိုင်ပါတယ်။

` +
    `🎯 <b>CatchBot</b>
` +
    `🤖 <b>BikaBot</b>
` +
    `🎃 <b>HallowBot</b>
` +
    `━━━━━━━━━━━━━━━━
` +
    `💼 Your Balance: <b>${fmt(balance)}</b> ${COIN}
` +
    `📌 Bot ရွေးပါ → Rarity ရွေးပါ → Card ID ရွေးပါ → Confirm Exchange နှိပ်ပါ။`
  );
}

function shopHomeKeyboard(ownerId) {
  return {
    inline_keyboard: [
      [
        primaryButton('🎯 CatchBot', `SHOP:BOT:catchbot:${ownerId}`),
        primaryButton('🤖 BikaBot', `SHOP:BOT:bikabot:${ownerId}`),
      ],
      [
        primaryButton('🎃 HallowBot', `SHOP:BOT:hallowbot:${ownerId}`),
      ],
      [
        primaryButton('📦 MyOrder', `SHOP:MYORDERS:${ownerId}`),
        successButton('ℹ️ Help', `SHOP:HELP:${ownerId}`),
      ],
    ],
  };
}

function botRarityText(botKey, balance, prices, counts) {
  const lines = getBotRarities(botKey).map((rarity) => (
    `${rarity.icon} <b>${rarity.label}</b>
` +
    `   Exchange: <b>${fmt(prices[rarity.key])}</b> ${COIN}
` +
    `   Stock: <b>${fmt(counts[rarity.key] || 0)}</b> cards`
  )).join('\n\n');

  return (
    `🎁 <b>${shopBotLabel(botKey)} Gift Card Exchange</b>
` +
    `━━━━━━━━━━━━━━━━
` +
    `${lines}
` +
    `━━━━━━━━━━━━━━━━
` +
    `💼 Your Balance: <b>${fmt(balance)}</b> ${COIN}
` +
    `📌 Rarity ရွေးပါ → Card ID ရွေးပါ → Confirm Exchange နှိပ်ပါ။`
  );
}

function botRarityKeyboard(botKey, counts, ownerId) {
  const rows = getBotRarities(botKey).map((rarity) => [
    primaryButton(
      `${rarity.icon} ${rarity.label} (${counts[rarity.key] || 0})`,
      `BUY:R:${botKey}:${rarity.key}:${ownerId}`
    ),
  ]);

  rows.push([dangerButton('⬅️ Back to Bot Menu', `BUY:HOME:${ownerId}`)]);

  return { inline_keyboard: rows };
}

async function rarityCardsText(botKey, rarityKey, price) {
  const rarity = rarityInfo(rarityKey, botKey);
  const cards = await shopCardModel.collection()
    .find({ rarity: rarityKey, status: 'AVAILABLE', ...shopBotFilter(botKey) })
    .sort({ cardId: 1 })
    .limit(30)
    .toArray();

  if (!cards.length) {
    return {
      text:
        `🎴 <b>${shopBotLabel(botKey)} — ${rarityLabel(rarityKey, botKey)} Exchange Cards</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `ဒီ rarity မှာ လဲလှယ်နိုင်တဲ့ card မရှိသေးပါ။`,
      cards,
    };
  }

  const cardLines = cards.map((card, index) => (
    `${index + 1}. <code>${escHtml(card.cardId)}</code>${card.name ? ` — ${escHtml(card.name)}` : ''}`
  )).join('\n');

  return {
    text:
      `🎴 <b>${shopBotLabel(botKey)} — ${rarity?.icon || ''} ${rarity?.label || rarityKey} Exchange Cards</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `Exchange: <b>${fmt(price)}</b> ${COIN}\n` +
      `Available: <b>${cards.length}</b>\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `${cardLines}\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `Game Coin နဲ့ လဲယူချင်တဲ့ Card ID ကိုရွေးပါ။`,
    cards,
  };
}

function cardsKeyboard(cards, ownerId, botKey) {
  const rows = [];
  let row = [];

  for (const card of cards) {
    row.push(primaryButton(
      String(card.cardId).slice(0, 24),
      `SHOP:CARD:${String(card._id)}:${ownerId}`
    ));

    if (row.length === 2) {
      rows.push(row);
      row = [];
    }
  }

  if (row.length) rows.push(row);
  rows.push([dangerButton('⬅️ Back to Rarities', `SHOP:BOT:${botKey}:${ownerId}`)]);

  return { inline_keyboard: rows };
}

function previewText(ctx, card, price) {
  return (
    `🧾 <b>Exchange Preview</b>
` +
    `━━━━━━━━━━━━━━━━
` +
    `User: ${mentionHtml(ctx.from)}
` +
    `User ID: <code>${ctx.from.id}</code>
` +
    `Bot: <b>${shopBotLabel(cardBotKey(card))}</b>
` +
    `Rarity: <b>${rarityLabel(card.rarity, cardBotKey(card))}</b>
` +
    `Card ID: <code>${escHtml(card.cardId)}</code>
` +
    `${card.name ? `Name: <b>${escHtml(card.name)}</b>
` : ''}` +
    `Exchange Cost: <b>${fmt(price)}</b> ${COIN}
` +
    `━━━━━━━━━━━━━━━━
` +
    `✅ Confirm Exchange နှိပ်မှ ${COIN} ဖြတ်ပြီး card လက်ဆောင် order တင်ပါမယ်။`
  );
}

function previewKeyboard(pendingId) {
  return {
    inline_keyboard: [
      [
        successButton('✅ Confirm Exchange', `SHOP:OK:${pendingId}`),
        dangerButton('❌ Cancel', `SHOP:NO:${pendingId}`),
      ],
    ],
  };
}

async function sendOrderPreview(ctx, card, price, pendingId) {
  const caption = previewText(ctx, card, price);
  const reply_markup = previewKeyboard(pendingId);

  if (card?.mediaFileId) {
    const extra = {
      caption,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup,
    };

    try {
      if (card.mediaType === 'video') {
        return await ctx.replyWithVideo(card.mediaFileId, extra);
      }

      if (card.mediaType === 'animation') {
        return await ctx.replyWithAnimation(card.mediaFileId, extra);
      }

      return await ctx.replyWithPhoto(card.mediaFileId, extra);
    } catch (_) {
      return replyHTML(ctx, caption, { reply_markup });
    }
  }

  return replyHTML(ctx, caption, { reply_markup });
}

function buyerPendingText(order, insertedId, balance, ownerNotified) {
  return (
    `✅ <b>Exchange Request Created</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Order ID: <code>${String(insertedId)}</code>\n` +
    `Receipt: <code>${order.receiptCode}</code>\n` +
    `User ID: <code>${order.userId}</code>\n` +
    `Bot: <b>${shopBotLabel(order.botKey || cardBotKey(order.card))}</b>\n` +
    `Rarity: <b>${rarityLabel(order.card.rarity, order.botKey || cardBotKey(order.card))}</b>\n` +
    `Card ID: <code>${escHtml(order.card.cardId)}</code>\n` +
    `${order.card.name ? `Name: <b>${escHtml(order.card.name)}</b>\n` : ''}` +
    `Used: <b>${fmt(order.price)}</b> ${COIN}\n` +
    `Balance: <b>${fmt(balance)}</b> ${COIN}\n` +
    `Status: <b>PENDING OWNER APPROVAL</b>\n` +
    `Owner Alert: <b>${ownerNotified ? 'SENT ✅' : 'FAILED ⚠️'}</b>`
  );
}

function ownerOrderText(order, insertedId) {
  return (
    `🎁 <b>New Card Exchange Request</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Order ID: <code>${String(insertedId)}</code>\n` +
    `Receipt: <code>${order.receiptCode}</code>\n` +
    `User: ${mentionHtml(order.buyer)}\n` +
    `User ID: <code>${order.userId}</code>\n` +
    `Username: <code>${escHtml(order.buyer.username ? '@' + order.buyer.username : 'N/A')}</code>\n` +
    `Bot: <b>${shopBotLabel(order.botKey || cardBotKey(order.card))}</b>\n` +
    `Rarity: <b>${rarityLabel(order.card.rarity, order.botKey || cardBotKey(order.card))}</b>\n` +
    `Card ID: <code>${escHtml(order.card.cardId)}</code>\n` +
    `${order.card.name ? `Name: <b>${escHtml(order.card.name)}</b>\n` : ''}` +
    `Used: <b>${fmt(order.price)}</b> ${COIN}\n` +
    `Status: <b>PENDING</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Approve လုပ်ရင် user DM ကို exchange completed message ပို့ပါမယ်။\n` +
    `Cancel လုပ်ရင် refund + user DM ပို့ပါမယ်။`
  );
}

function ownerOrderKeyboard(orderId) {
  return {
    inline_keyboard: [
      [
        successButton('✅ Approve', `SHOPADMIN:APPROVE:${orderId}`),
        dangerButton('❌ Cancel', `SHOPADMIN:CANCEL:${orderId}`),
      ],
    ],
  };
}

function buyerCompletedText(order) {
  return (
    `✅ <b>Exchange ပြီးမြောက်ပါပြီ</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Receipt: <code>${escHtml(order.receiptCode || 'N/A')}</code>\n` +
    `Bot: <b>${shopBotLabel(order.botKey || 'bikabot')}</b>\n` +
    `Rarity: <b>${rarityLabel(order.rarity, order.botKey || 'bikabot')}</b>\n` +
    `Card ID: <code>${escHtml(order.cardId || 'N/A')}</code>\n` +
    `${order.itemName ? `Name: <b>${escHtml(order.itemName)}</b>\n` : ''}` +
    `Used: <b>${fmt(order.price || 0)}</b> ${COIN}\n` +
    `Status: <b>COMPLETED ✅</b>`
  );
}

function buyerCancelledText(order, refunded) {
  return (
    `❌ <b>Exchange Cancelled</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Receipt: <code>${escHtml(order.receiptCode || 'N/A')}</code>\n` +
    `Bot: <b>${shopBotLabel(order.botKey || 'bikabot')}</b>\n` +
    `Rarity: <b>${rarityLabel(order.rarity, order.botKey || 'bikabot')}</b>\n` +
    `Card ID: <code>${escHtml(order.cardId || 'N/A')}</code>\n` +
    `${order.itemName ? `Name: <b>${escHtml(order.itemName)}</b>\n` : ''}` +
    `Refund Amount: <b>${fmt(order.price || 0)}</b> ${COIN}\n` +
    `Refund: <b>${refunded ? 'DONE ✅' : 'FAILED ⚠️'}</b>\n` +
    `Status: <b>CANCELLED</b>`
  );
}

function ownerCompletedText(order, action) {
  return (
    `${action === 'APPROVE' ? '✅ <b>Exchange Approved</b>' : '❌ <b>Exchange Cancelled</b>'}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Order ID: <code>${String(order._id)}</code>\n` +
    `Receipt: <code>${escHtml(order.receiptCode || 'N/A')}</code>\n` +
    `User ID: <code>${order.userId}</code>\n` +
    `Bot: <b>${shopBotLabel(order.botKey || 'bikabot')}</b>\n` +
    `Rarity: <b>${rarityLabel(order.rarity, order.botKey || 'bikabot')}</b>\n` +
    `Card ID: <code>${escHtml(order.cardId || 'N/A')}</code>\n` +
    `Used: <b>${fmt(order.price || 0)}</b> ${COIN}\n` +
    `Status: <b>${action === 'APPROVE' ? 'COMPLETED' : 'CANCELLED'}</b>`
  );
}

function cancelledText(order) {
  return (
    `❌ <b>Exchange Cancelled</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Rarity: <b>${rarityLabel(order.card.rarity, order.botKey || cardBotKey(order.card))}</b>\n` +
    `Card ID: <code>${escHtml(order.card.cardId)}</code>\n` +
    `Exchange Cost: <b>${fmt(order.price)}</b> ${COIN}`
  );
}

function expiredText(order) {
  return (
    `⌛ <b>Exchange Expired</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Rarity: <b>${rarityLabel(order.card.rarity, order.botKey || cardBotKey(order.card))}</b>\n` +
    `Card ID: <code>${escHtml(order.card.cardId)}</code>\n` +
    `Exchange Cost: <b>${fmt(order.price)}</b> ${COIN}\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `<code>/shop</code> ပြန်ဖွင့်ပြီး exchange အသစ်တင်ပါ။`
  );
}

function helpText() {
  return (
    `ℹ️ <b>BIKA Game Coin To Card Help</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Player:\n` +
    `• <code>/shop</code> or <code>.shop</code>\n` +
    `• Bot ရွေးပါ\n` +
    `• Rarity ရွေးပါ\n` +
    `• Card ID ရွေးပါ\n` +
    `• Confirm Exchange နှိပ်ပါ\n\n` +
    `Rule:\n` +
    `• <b>Bot Dm မှာ /start နှိပ်ထားဖို့လိုအပ်ပါတယ်</b>\n` +
    `• <b>Confirm နှိပ်ပြီးရင် Cancel နှိပ်မရတော့ပါ</b>\n` +
    `• <b>မိမိရဲ့ လက်ကျန် ${COIN} မလုံလောက်ရင် card လဲယူလို့မရနိုင်ပါ</b>\n` +
    `• Exchange request တင်ပြီးရင် My Order ထဲမှာ status စစ်ဆေးလို့ရပါတယ်။`
  );
}

function textFromInlineMessage(message) {
  return String(message?.caption || message?.text || '').trim();
}

function extractMedia(message) {
  if (Array.isArray(message?.photo) && message.photo.length) {
    const best = message.photo[message.photo.length - 1];

    return {
      mediaType: 'photo',
      mediaFileId: best?.file_id || null,
    };
  }

  if (message?.video?.file_id) {
    return {
      mediaType: 'video',
      mediaFileId: message.video.file_id,
    };
  }

  if (message?.animation?.file_id) {
    return {
      mediaType: 'animation',
      mediaFileId: message.animation.file_id,
    };
  }

  return {
    mediaType: null,
    mediaFileId: null,
  };
}

function parseInlineCard(text) {
  const raw = String(text || '').replace(/\r/g, '\n');
  const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
  const joined = lines.join('\n');

  let id = null;
  let name = null;
  let rarity = null;

  const idPatterns = [
    /(?:^|\n)\s*(?:id|card\s*id)\s*[:#]?\s*([A-Za-z0-9_-]+)/i,
    /(?:^|\n)\s*(\d{1,10})\s*[:.)-]\s*([^\n]+)/,
    /(?:^|\n)\s*(\d{1,10})\s*:\s*([^\n]+)/,
  ];

  for (const pattern of idPatterns) {
    const match = joined.match(pattern);

    if (match) {
      id = match[1];

      if (!name && match[2]) {
        name = match[2].trim();
      }

      break;
    }
  }

  if (!id) {
    const loose = joined.match(/\b(\d{1,10})\s*:\s*([^\n]+)/);

    if (loose) {
      id = loose[1];
      name = loose[2].trim();
    }
  }

  const rarityMatch = joined.match(/rarity\s*[:：]?\s*([A-Za-z]+(?:\s*[A-Za-z]+)?)/i);

  if (rarityMatch) {
    rarity = normalizeRarity(rarityMatch[1]);
  }

  if (!rarity) {
    for (const rarityInfoItem of RARITIES) {
      const pattern = new RegExp(`\\b${rarityInfoItem.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

      if (pattern.test(joined)) {
        rarity = rarityInfoItem.key;
        break;
      }
    }
  }

  if (!name && id) {
    const idLine = lines.find((line) => line.includes(id));

    if (idLine) {
      name = idLine
        .replace(new RegExp(`^\\s*${id}\\s*[:.)-]?\\s*`, 'i'), '')
        .replace(/\(\s*.*?rarity.*?\)/i, '')
        .trim();
    }
  }

  if (name) {
    name = name
      .replace(/\(\s*[🔵🟣🟠🟡💮⚜️⚡🎐🎴✨🪞]?\s*rarity\s*[:：]?\s*[A-Za-z]+\s*\)/i, '')
      .replace(/[|]+$/g, '')
      .trim();
  }

  return {
    cardId: id ? String(id).trim() : null,
    name: name || null,
    rarity,
    rawText: raw,
  };
}

function inlineAddUsage() {
  return (
    `Usage:\n` +
    `1) Inline bot message ကို reply လုပ်ပါ\n` +
    `2) <code>/shopaddinline</code> ပို့ပါ\n\n` +
    `Supported source bots:\n` +
    `• @Character_Catcher_Bot → CatchBot\n` +
    `• @BikaCharacterBot → BikaBot\n` +
    `• @Characters_Hallow_bot → HallowBot`
  );
}

function inlineAddResultText(data) {
  return (
    `✅ <b>Inline Card Added</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `Bot: <b>${shopBotLabel(data.botKey)}</b>\n` +
    `Source: <code>${escHtml(data.sourceBotUsername ? '@' + data.sourceBotUsername : 'N/A')}</code>\n` +
    `Rarity: <b>${rarityLabel(data.rarity, data.botKey)}</b>\n` +
    `Card ID: <code>${escHtml(data.cardId)}</code>\n` +
    `${data.name ? `Name: <b>${escHtml(data.name)}</b>\n` : ''}` +
    `Media: <b>${data.mediaType && data.mediaFileId ? data.mediaType.toUpperCase() + ' ✅' : 'NO MEDIA ⚠️'}</b>`
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
    return `📦 <b>My Exchange Requests</b>\n━━━━━━━━━━━━━━━━\nExchange request မရှိသေးပါ။`;
  }

  const lines = orders.map((order, index) => (
    `${index + 1}. <code>${String(order._id)}</code>\n` +
    `   User ID: <code>${order.userId}</code>\n` +
    `   Bot: <b>${shopBotLabel(order.botKey || 'bikabot')}</b>\n` +
    `   Rarity: <b>${escHtml(order.rarity || 'N/A')}</b>\n` +
    `   Card ID: <code>${escHtml(order.cardId || order.itemId || 'N/A')}</code>\n` +
    `   Used: <b>${fmt(order.price || 0)}</b> ${COIN}\n` +
    `   Status: <b>${escHtml(order.status || 'PENDING')}</b>`
  )).join('\n\n');

  return `📦 <b>My Recent Exchange Requests</b>\n━━━━━━━━━━━━━━━━\n${lines}`;
}

async function openShop(ctx, targetBot = null) {
  if (!(await requireShopDm(ctx, targetBot))) return;
  if (!(await requireShopOpen(ctx))) return;

  const user = await getUser(ctx.from.id);

  return replyHTML(ctx, shopHomeText(user?.balance || 0), {
    ...replyOptions(ctx),
    reply_markup: shopHomeKeyboard(ctx.from.id),
  });
}

async function showBotHome(ctx, botKey, ownerId) {
  const user = await getUser(ctx.from.id);
  const prices = await getPriceMap();
  const counts = await countAvailableByRarity(botKey);

  try {
    await ctx.answerCbQuery(`${shopBotInfo(botKey)?.label || 'Shop'} opened.`);
  } catch (_) {}

  return editCurrentHTML(ctx, botRarityText(botKey, user?.balance || 0, prices, counts), {
    reply_markup: botRarityKeyboard(botKey, counts, ownerId),
  });
}

async function showRarity(ctx, botKey, rarityKey, ownerId) {
  const prices = await getPriceMap();
  const { text, cards } = await rarityCardsText(botKey, rarityKey, prices[rarityKey]);

  try {
    await ctx.answerCbQuery(`${shopBotInfo(botKey)?.label || 'Shop'} ${rarityInfo(rarityKey, botKey)?.label || rarityKey} cards`);
  } catch (_) {}

  return editCurrentHTML(ctx, text, { reply_markup: cardsKeyboard(cards, ownerId, botKey) });
}

async function handleBuy(ctx, payload) {
  cleanupPendingOrders();

  if (!(await requireShopDm(ctx, null, 'callback'))) return;
  if (!(await requireShopOpen(ctx, 'callback'))) return;

  const parts = String(payload || '').split(':');

  if (parts[0] === 'HOME') {
    const ownerId = parts[1];

    if (!(await requireButtonOwner(ctx, ownerId))) return;

    const user = await getUser(ctx.from.id);

    try { await ctx.answerCbQuery('Back to shop.'); } catch (_) {}

    return editCurrentHTML(ctx, shopHomeText(user?.balance || 0), {
      reply_markup: shopHomeKeyboard(ctx.from.id),
    });
  }

  if (parts[0] !== 'R') {
    return ctx.answerCbQuery('Unknown shop action.', { show_alert: true });
  }

  const botKey = normalizeShopBot(parts[1]);
  const rarityKey = normalizeRarity(parts[2]);
  const ownerId = parts[3];

  if (!(await requireButtonOwner(ctx, ownerId))) return;

  if (!botKey || !shopBotInfo(botKey)) {
    return ctx.answerCbQuery('Shop bot not found.', { show_alert: true });
  }

  if (!rarityKey || !rarityInfo(rarityKey)) {
    return ctx.answerCbQuery('Rarity not found.', { show_alert: true });
  }

  return showRarity(ctx, botKey, rarityKey, ctx.from.id);
}

module.exports = (bot) => {
  bot.command('shopon', async (ctx) => {
    if (!(await requireOwner(ctx))) return;

    await setShopEnabled(true, ctx.from?.id);

    return replyHTML(
      ctx,
      '✅ <b>Shop System ON</b>\n' +
        '━━━━━━━━━━━━━━━━\n' +
        'User တွေ <code>/shop</code> သုံးနိုင်ပါပြီ။',
      replyOptions(ctx)
    );
  });

  bot.command('shopoff', async (ctx) => {
    if (!(await requireOwner(ctx))) return;

    await setShopEnabled(false, ctx.from?.id);

    return replyHTML(
      ctx,
      '⛔ <b>Shop System OFF</b>\n' +
        '━━━━━━━━━━━━━━━━\n' +
        'Shop ကိုပိတ်ထားပါတယ်။\n' +
        'Owner ပဲ <code>/shop</code> ဆက်သုံးနိုင်ပါမယ်။',
      replyOptions(ctx)
    );
  });

  bot.command('shop', (ctx) => openShop(ctx, bot));
  bot.hears(/^\.(shop)\s*$/i, (ctx) => openShop(ctx, bot));

  bot._bikaHandleBuy = handleBuy;

  bot.on('callback_query', async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || '');

    if (!data.startsWith('SHOP:') && !data.startsWith('SHOPADMIN:')) {
      return next();
    }

    cleanupPendingOrders();

    if (data.startsWith('SHOP:') && !(await requireShopDm(ctx, bot, 'callback'))) return;
    if (data.startsWith('SHOP:') && !(await requireShopOpen(ctx, 'callback'))) return;

    if (data.startsWith('SHOP:BOT:')) {
      const [, , botKeyRaw, ownerId] = data.split(':');
      const botKey = normalizeShopBot(botKeyRaw);

      if (!(await requireButtonOwner(ctx, ownerId))) return;

      if (!botKey || !shopBotInfo(botKey)) {
        return ctx.answerCbQuery('Shop bot not found.', { show_alert: true });
      }

      return showBotHome(ctx, botKey, ctx.from.id);
    }

    if (data.startsWith('SHOP:HELP:')) {
      const [, , ownerId] = data.split(':');

      if (!(await requireButtonOwner(ctx, ownerId))) return;

      try { await ctx.answerCbQuery('Help opened.'); } catch (_) {}
      return editCurrentHTML(ctx, helpText(), {
        reply_markup: {
          inline_keyboard: [[dangerButton('⬅️ Back to Shop', `BUY:HOME:${ctx.from.id}`)]],
        },
      });
    }

    if (data.startsWith('SHOP:MYORDERS:')) {
      const [, , ownerId] = data.split(':');

      if (!(await requireButtonOwner(ctx, ownerId))) return;

      try { await ctx.answerCbQuery('My orders opened.'); } catch (_) {}
      return editCurrentHTML(ctx, await myOrdersText(ctx.from.id), {
        reply_markup: {
          inline_keyboard: [[dangerButton('⬅️ Back to Shop', `BUY:HOME:${ctx.from.id}`)]],
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
      const [, , cardObjectId, ownerId] = data.split(':');

      if (!(await requireButtonOwner(ctx, ownerId))) return;

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

      try { await ctx.answerCbQuery('Exchange preview opened.'); } catch (_) {}

      await deleteCallbackMessage(ctx);

      const sent = await sendOrderPreview(ctx, card, price, pendingId);

      if (!sent?.message_id) return;

      const pending = {
        id: pendingId,
        userId: ctx.from.id,
        buyer: ctx.from,
        chatId: ctx.chat.id,
        msgId: sent.message_id,
        cardObjectId,
        card,
        botKey: cardBotKey(card),
        hasMedia: !!card.mediaFileId,
        price,
        expiresAt,
        timeoutHandle: null,
      };

      pending.timeoutHandle = setTimeout(async () => {
        const expired = pendingOrders.get(pendingId);
        if (!expired) return;
        pendingOrders.delete(pendingId);
        try {
          await editOrderMessage(bot, expired.chatId, expired.msgId, expiredText(expired), expired.hasMedia);
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
        await ctx.answerCbQuery('သက်ဆိုင်တဲ့ User ပဲ Confirm/Cancel လုပ်နိုင်ပါတယ်။', { show_alert: true });
      } catch (_) {}
      return;
    }

    if (action === 'NO') {
      clearPending(id);
      try { await ctx.answerCbQuery('Order cancelled.'); } catch (_) {}
      return editOrderMessage(bot, pending.chatId, pending.msgId, cancelledText(pending), pending.hasMedia);
    }

    try { await ctx.answerCbQuery('Creating exchange request...'); } catch (_) {}

    try {
      const latestCard = await shopCardModel.collection().findOne({
        _id: new ObjectId(pending.cardObjectId),
        status: 'AVAILABLE',
      });

      if (!latestCard) {
        clearPending(id);
        return editOrderMessage(
          bot,
          pending.chatId,
          pending.msgId,
          '⚠️ <b>Card unavailable</b>\n━━━━━━━━━━━━━━━━\nဒီ card ကို တစ်ခြားသူလဲယူသွားပြီးဖြစ်နိုင်ပါတယ်။',
          pending.hasMedia
        );
      }

      await userPayToTreasury(pending.userId, pending.price, {
        type: 'shop_card_exchange',
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
        botKey: pending.botKey || cardBotKey(latestCard),
        rarity: latestCard.rarity,
        mediaType: latestCard.mediaType || null,
        mediaFileId: latestCard.mediaFileId || null,
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

      return editOrderMessage(
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
        ),
        pending.hasMedia
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
    if (!(await requireShopDm(ctx, bot))) return;
    if (!(await requireShopOpen(ctx))) return;

    return replyHTML(ctx, await myOrdersText(ctx.from.id), replyOptions(ctx));
  });

  bot.command('shophelp', async (ctx) => {
    if (!(await requireShopDm(ctx, bot))) return;
    if (!(await requireShopOpen(ctx))) return;

    return replyHTML(ctx, helpText(), replyOptions(ctx));
  });

  bot.command(['shopaddinline', 'shopaddmedia'], async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const replied = ctx.message?.reply_to_message;

    if (!replied) {
      return replyHTML(ctx, inlineAddUsage(), replyOptions(ctx));
    }

    const source = sourceBotFromMessage(replied);

    if (!source.botKey) {
      return replyHTML(
        ctx,
        `⚠️ <b>Unsupported source bot.</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `Detected: <code>${escHtml(source.username ? '@' + source.username : 'unknown')}</code>\n\n` +
          `${inlineAddUsage()}`,
        replyOptions(ctx)
      );
    }

    const parsed = parseInlineCard(textFromInlineMessage(replied));

    if (!parsed.cardId || !parsed.rarity || !rarityInfo(parsed.rarity)) {
      return replyHTML(
        ctx,
        `⚠️ <b>Card data parse မရပါ။</b>\n` +
          `━━━━━━━━━━━━━━━━\n` +
          `Card ID / Name / Rarity ပါတဲ့ inline bot message ကို reply လုပ်ပြီး <code>/shopaddinline</code> ပို့ပါ။\n\n` +
          `${inlineAddUsage()}`,
        replyOptions(ctx)
      );
    }

    const media = extractMedia(replied);
    const now = new Date();

    await shopCardModel.collection().updateOne(
      {
        botKey: source.botKey,
        cardId: parsed.cardId,
      },
      {
        $setOnInsert: {
          botKey: source.botKey,
          cardId: parsed.cardId,
          createdAt: now,
        },
        $set: {
          sourceBotUsername: source.username ? source.username.toLowerCase() : null,
          sourceBotKey: source.botKey,
          rarity: parsed.rarity,
          name: parsed.name || null,
          mediaType: media.mediaType,
          mediaFileId: media.mediaFileId,
          caption: parsed.rawText,
          status: 'AVAILABLE',
          addedByUserId: ctx.from.id,
          updatedAt: now,
        },
      },
      { upsert: true }
    );

    return replyHTML(
      ctx,
      inlineAddResultText({
        botKey: source.botKey,
        sourceBotUsername: source.username,
        cardId: parsed.cardId,
        name: parsed.name,
        rarity: parsed.rarity,
        mediaType: media.mediaType,
        mediaFileId: media.mediaFileId,
      }),
      replyOptions(ctx)
    );
  });

  bot.command('fixshopindex', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const collection = shopCardModel.collection();
    const report = [];

    try {
      const migrate = await collection.updateMany(
        {
          $or: [
            { botKey: { $exists: false } },
            { botKey: null },
            { botKey: '' },
          ],
        },
        {
          $set: {
            botKey: 'bikabot',
            sourceBotKey: 'bikabot',
            updatedAt: new Date(),
          },
        }
      );

      report.push(`✅ Old cards migrated to BikaBot: ${fmt(migrate.modifiedCount || 0)}`);
    } catch (err) {
      report.push(`⚠️ Old card migration warning: ${escHtml(err?.message || err)}`);
    }

    try {
      await collection.dropIndex('cardId_1');
      report.push('✅ Dropped old unique index: cardId_1');
    } catch (_) {
      report.push('ℹ️ Old index cardId_1 not found/already removed.');
    }

    try {
      await collection.createIndex(
        { botKey: 1, cardId: 1 },
        {
          unique: true,
          name: 'botKey_1_cardId_1',
        }
      );

      report.push('✅ Created new unique index: botKey_1_cardId_1');
    } catch (err) {
      report.push(`❌ New index create failed: ${escHtml(err?.message || err)}`);
    }

    return replyHTML(
      ctx,
      `🛠 <b>Shop Index Fix</b>\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `${report.join('\n')}`,
      replyOptions(ctx)
    );
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
        `Usage: <code>/setrarityprice Oblivion 5000000</code>\n` +
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
        `Exchange Cost: <b>${fmt(price)}</b> ${COIN}`,
      replyOptions(ctx)
    );
  });

  bot.command('shopadd', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const parts = String(ctx.message?.text || '').trim().split(/\s+/);
    const parsed = parseBotAndRarity(parts, 1);
    const botKey = parsed.botKey;
    const rarityKey = parsed.rarityKey;
    const cardId = parts[parsed.nextIndex];
    const name = parts.slice(parsed.nextIndex + 1).join(' ').trim();

    if (!rarityKey || !rarityInfo(rarityKey) || !cardId) {
      return replyHTML(
        ctx,
        `Usage: <code>/shopadd HallowBot Oblivion H001</code>\n` +
          `Default: <code>/shopadd Divine D001</code> = BikaBot\n` +
          `Optional: <code>/shopadd HallowBot Abyssion H001 Character Name</code>`,
        replyOptions(ctx)
      );
    }

    const now = new Date();

    await shopCardModel.collection().updateOne(
      { cardId: String(cardId) },
      {
        $setOnInsert: { cardId: String(cardId), createdAt: now },
        $set: {
          botKey,
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
        `Bot: <b>${shopBotLabel(botKey)}</b>\n` +
        `Rarity: <b>${rarityLabel(rarityKey)}</b>\n` +
        `Card ID: <code>${escHtml(cardId)}</code>\n` +
        `${name ? `Name: <b>${escHtml(name)}</b>` : ''}`,
      replyOptions(ctx)
    );
  });

  bot.command('shopbulk', async (ctx) => {
    if (!(await requireOwnerDm(ctx))) return;

    const parts = String(ctx.message?.text || '').trim().split(/\s+/);
    const parsed = parseBotAndRarity(parts, 1);
    const botKey = parsed.botKey;
    const rarityKey = parsed.rarityKey;
    const cardIds = parts.slice(parsed.nextIndex).filter(Boolean);

    if (!rarityKey || !rarityInfo(rarityKey) || !cardIds.length) {
      return replyHTML(
        ctx,
        `Usage: <code>/shopbulk HallowBot Oblivion H001 H002 H003</code>\n` +
          `Default: <code>/shopbulk Divine D001 D002</code> = BikaBot`,
        replyOptions(ctx)
      );
    }

    const now = new Date();

    const operations = cardIds.map((cardId) => ({
      updateOne: {
        filter: { cardId: String(cardId) },
        update: {
          $setOnInsert: { cardId: String(cardId), createdAt: now },
          $set: {
            botKey,
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
        `Bot: <b>${shopBotLabel(botKey)}</b>\n` +
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
    const botKey = normalizeShopBot(parts[1]);
    const finalBotKey = botKey || 'bikabot';
    const rarityKey = botKey ? normalizeRarity(parts[2]) : normalizeRarity(parts[1]);

    const query = rarityKey
      ? { rarity: rarityKey, status: 'AVAILABLE', ...shopBotFilter(finalBotKey) }
      : { status: 'AVAILABLE', ...shopBotFilter(finalBotKey) };

    const cards = await shopCardModel.collection()
      .find(query)
      .sort({ rarity: 1, cardId: 1 })
      .limit(50)
      .toArray();

    if (!cards.length) {
      return replyHTML(ctx, '📦 Available card မရှိသေးပါ။', replyOptions(ctx));
    }

    const lines = cards.map((card, index) => (
      `${index + 1}. ${shopBotLabel(cardBotKey(card))} — ${rarityLabel(card.rarity, cardBotKey(card))} — <code>${escHtml(card.cardId)}</code>${card.name ? ` — ${escHtml(card.name)}` : ''}${card.mediaFileId ? ' — 📎' : ''}`
    )).join('\n');

    return replyHTML(ctx, `🎴 <b>Available Exchange Cards</b>\n━━━━━━━━━━━━━━━━\n${lines}`, replyOptions(ctx));
  });
};

module.exports.RARITIES = RARITIES;
module.exports.SHOP_BOTS = SHOP_BOTS;
