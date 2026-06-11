'use strict';

const { COIN } = require('../../config/constants');
const { SELL_BOTS, getBotConfig } = require('../../config/sellCatalog');
const sellService = require('../../services/sellService');
const { fmt } = require('../../utils/format');
const { getBotInfo } = require('../../config/bot');
const { getDb } = require('../../config/database');

const pendingLinks = new Map();
const GIFT_INSTRUCTION_LINK = 'https://t.me/WaifuCheatBotChat/431645';
const PENDING_TTL_MS = Number(process.env.SELL_PENDING_TTL_MS || 10 * 60 * 1000);
const SELL_ENABLED_CONFIG_KEY = 'sell_system_enabled';

function h(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function money(value) {
  return `${fmt(Number(value) || 0)} ${COIN}`;
}

function configCollection() {
  return getDb().collection('config');
}

async function isSellEnabled() {
  const doc = await configCollection().findOne({ key: SELL_ENABLED_CONFIG_KEY });
  return doc?.value !== false;
}

async function setSellEnabled(enabled, ownerId) {
  await configCollection().updateOne(
    { key: SELL_ENABLED_CONFIG_KEY },
    {
      $set: {
        key: SELL_ENABLED_CONFIG_KEY,
        value: !!enabled,
        updatedAt: new Date(),
        updatedBy: ownerId || null,
      },
      $setOnInsert: {
        createdAt: new Date(),
      },
    },
    { upsert: true }
  );

  return !!enabled;
}

function sellDisabledText() {
  return (
    '⛔ <b>Sell System ပိတ်ထားပါတယ်။</b>\n\n' +
    'Owner က <code>/sellon</code> ပြန်ဖွင့်မှ အသုံးပြုနိုင်ပါမယ်။'
  );
}

function isSellOwner(ctx) {
  return sellService.isOwner(ctx.from?.id);
}

async function canUseSellSystem(ctx) {
  if (isSellOwner(ctx)) return true;
  return isSellEnabled();
}

async function requireSellSystemAvailable(ctx) {
  if (await canUseSellSystem(ctx)) return true;

  clearPending(ctx);

  try {
    await editHtml(ctx, sellDisabledText());
  } catch (_) {
    await replyHtml(ctx, sellDisabledText());
  }

  return false;
}

function pendingKey(ctx) {
  return `${ctx.from?.id || 0}:${ctx.chat?.id || 0}`;
}

function setPending(ctx, payload) {
  const key = pendingKey(ctx);
  const old = pendingLinks.get(key);
  if (old?.timer) clearTimeout(old.timer);

  const timer = setTimeout(() => pendingLinks.delete(key), PENDING_TTL_MS);
  pendingLinks.set(key, {
    ...payload,
    createdAt: Date.now(),
    timer,
  });
}

function clearPending(ctx) {
  const key = pendingKey(ctx);
  const old = pendingLinks.get(key);
  if (old?.timer) clearTimeout(old.timer);
  pendingLinks.delete(key);
}

function getPending(ctx) {
  return pendingLinks.get(pendingKey(ctx)) || null;
}

function keyboard(rows) {
  return { inline_keyboard: rows };
}

function styledButton(button, style = 'primary') {
  return {
    ...button,
    style,
  };
}

function cb(text, data, style = 'primary') {
  return styledButton({ text, callback_data: data }, style);
}

function urlButton(text, url, style = 'primary') {
  return styledButton({ text, url }, style);
}

function isPrivateChat(ctx) {
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

  return keyboard([[urlButton('Go to DM', `https://t.me/${username}?start=sell`, 'primary')]]);
}

function dmOnlyText() {
  return (
    'ℹ️ <b>This command is only use in DM.</b>\n\n' +
    'Please open bot DM and use <code>/sell</code> there.'
  );
}

function mainMenuKeyboard() {
  return keyboard([
    [cb('CatchBot', 'sell:bot:catchbot'), cb('HallowBot', 'sell:bot:hallowbot')],
    [cb('Yelan Card', 'sell:bot:yelan'), cb('BikaBot', 'sell:bot:bikabot')],
    [cb('My Sell List', 'sell:my'), cb('Help', 'sell:help', 'success')],
  ]);
}

function rarityKeyboard(botKey) {
  const bot = getBotConfig(botKey);
  const rows = [];

  for (const rarity of bot.rarities) {
    rows.push([cb(rarity.label, `sell:rarity:${bot.key}:${rarity.key}`)]);
  }

  rows.push([cb('⬅️ Back', 'sell:menu', 'danger')]);
  return keyboard(rows);
}

function confirmKeyboard(botKey, rarityKey) {
  return keyboard([
    [cb('⬅️ Back to Rarity', `sell:bot:${botKey}`, 'danger'), cb('✅ Yes I Sell', `sell:yes:${botKey}:${rarityKey}`)],
  ]);
}

function ownerKeyboard(orderId) {
  return keyboard([
    [cb('✅ Approve', `sell:owner:approve:${orderId}`), cb('❌ Cancel', `sell:owner:cancel:${orderId}`, 'danger')],
  ]);
}

async function replyHtml(ctx, text, replyMarkup) {
  return ctx.reply(text, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: replyMarkup,
  });
}

async function editHtml(ctx, text, replyMarkup) {
  try {
    return await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    });
  } catch (err) {
    return replyHtml(ctx, text, replyMarkup);
  }
}

function sellMenuText() {
  return (
    '💳 <b>Card Sell System</b>\n' +
    '━━━━━━━━━━━━━━\n' +
    'ရောင်းချမယ့် Bot/Card အမျိုးအစားကို ရွေးပါ။\n\n' +
    'Order တင်ပြီး Owner approve လုပ်မှ coin ပေါင်းထည့်ပေးပါမယ်။'
  );
}

function rarityText(botKey) {
  const bot = getBotConfig(botKey);
  const note = bot.note ? `\n\n⚠️ <b>${h(bot.note)}</b>` : '';

  return (
    `💳 <b>${h(bot.name)} Sell</b>\n` +
    '━━━━━━━━━━━━━━\n' +
    'ရောင်းချမယ့် Rarity ကိုရွေးပါ။' +
    note
  );
}

async function priceText(botKey, rarityKey) {
  const price = await sellService.getPrice(botKey, rarityKey);

  if (!price) {
    return '❌ Price မတွေ့ပါ။';
  }

  return (
    `💳 <b>${h(price.botName)} Sell</b>\n` +
    '━━━━━━━━━━━━━━\n' +
    `Rarity: <b>${h(price.rarityLabel)}</b>\n` +
    `Price: <b>${money(price.price)}</b>\n\n` +
    'ဒီ price နဲ့ရောင်းချမယ်ဆိုရင် <b>Yes I Sell</b> ကိုနှိပ်ပါ။'
  );
}

function orderCreatedText(order, ownerAlertSent) {
  return (
    '✅ <b>Order Created</b>\n\n' +
    `Order ID: <code>${h(order.orderId)}</code>\n` +
    `Receipt: <code>${h(order.receipt)}</code>\n` +
    `Seller ID: <code>${h(order.sellerId)}</code>\n` +
    `Bot: <b>${h(order.botName)}</b>\n` +
    `Rarity: <b>${h(order.rarityLabel)}</b>\n` +
    `Gift Link: ${h(order.giftLink)}\n` +
    `Price: <b>${money(order.price)}</b>\n` +
    'Status: <b>PENDING OWNER APPROVAL</b>\n' +
    `Owner Alert: ${ownerAlertSent ? 'SENT ✅' : 'FAILED ⚠️'}`
  );
}

function ownerAlertText(order) {
  const username = order.sellerUsername ? `@${order.sellerUsername}` : '-';

  return (
    '🔔 <b>New Sell Order</b>\n\n' +
    `Order ID: <code>${h(order.orderId)}</code>\n` +
    `Receipt: <code>${h(order.receipt)}</code>\n` +
    `Seller ID: <code>${h(order.sellerId)}</code>\n` +
    `Seller: <b>${h(order.sellerName || '-')}</b> ${h(username)}\n` +
    `Bot: <b>${h(order.botName)}</b>\n` +
    `Rarity: <b>${h(order.rarityLabel)}</b>\n` +
    `Gift Link: ${h(order.giftLink)}\n` +
    `Price: <b>${money(order.price)}</b>\n` +
    'Status: <b>PENDING OWNER APPROVAL</b>'
  );
}

function finalOwnerText(order, status) {
  const label = status === 'APPROVED' ? '✅ APPROVED' : '❌ CANCELLED';

  return (
    `<b>${label}</b>\n\n` +
    `Order ID: <code>${h(order.orderId)}</code>\n` +
    `Seller ID: <code>${h(order.sellerId)}</code>\n` +
    `Bot: <b>${h(order.botName)}</b>\n` +
    `Rarity: <b>${h(order.rarityLabel)}</b>\n` +
    `Price: <b>${money(order.price)}</b>\n` +
    `Gift Link: ${h(order.giftLink)}\n` +
    `Status: <b>${h(order.status)}</b>`
  );
}

function userApprovedText(order) {
  return (
    '✅ <b>Sell Order Approved</b>\n\n' +
    `Order ID: <code>${h(order.orderId)}</code>\n` +
    `Bot: <b>${h(order.botName)}</b>\n` +
    `Rarity: <b>${h(order.rarityLabel)}</b>\n` +
    `Price: <b>${money(order.price)}</b>\n\n` +
    'Balance ထဲသို့ coin ပေါင်းထည့်ပြီးပါပြီ။'
  );
}

function userCancelledText(order) {
  return (
    '❌ <b>Sell Order Cancelled</b>\n\n' +
    `Order ID: <code>${h(order.orderId)}</code>\n` +
    `Bot: <b>${h(order.botName)}</b>\n` +
    `Rarity: <b>${h(order.rarityLabel)}</b>\n` +
    `Price: <b>${money(order.price)}</b>\n` +
    'Status: <b>CANCELLED</b>'
  );
}

function helpText() {
  return (
    'ℹ️ <b>Sell Help</b>\n' +
    '━━━━━━━━━━━━━━\n' +
    '1. <code>/sell</code> ပို့ပါ။\n' +
    '2. Bot/Card အမျိုးအစားရွေးပါ။\n' +
    '3. Rarity ရွေးပါ။\n' +
    '4. Price ကြည့်ပြီး <b>Yes I Sell</b> နှိပ်ပါ။\n' +
    `5. ${h(GIFT_INSTRUCTION_LINK)} ကစာကို reply ထောက်ပြီး Gift ပါ။\n` +
    '6. Gift ပြီးသွားတဲ့ message link ကို ဒီ chat ထဲပို့ပါ။\n' +
    '7. Owner approve လုပ်ပြီးရင် coin ဝင်ပါမယ်။\n\n' +
    '<b>Owner price command</b>\n' +
    '<code>/sellpriceadd catchbot legendary 10000</code>\n' +
    '<code>/sellpriceadd hallowbot eldritch 100000</code>\n' +
    '<code>/sellpriceadd yelan common 5000</code>\n' +
    '<code>/sellpriceadd bika divine 300000</code>'
  );
}

async function notifyOwners(ctx, order) {
  const ownerIds = sellService.getOwnerIds();
  const alerts = [];

  for (const ownerId of ownerIds) {
    try {
      const sent = await ctx.telegram.sendMessage(ownerId, ownerAlertText(order), {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: ownerKeyboard(order.orderId),
      });

      alerts.push({ ownerId, messageId: sent.message_id, sentAt: new Date() });
    } catch (err) {
      alerts.push({ ownerId, error: err?.message || String(err), sentAt: new Date() });
    }
  }

  await sellService.markOwnerAlert(order.orderId, alerts);
  return alerts.some((alert) => alert.messageId);
}

async function showMyOrders(ctx) {
  const orders = await sellService.listSellerOrders(ctx.from.id, 10);

  if (!orders.length) {
    return editHtml(ctx, '📋 <b>My Sell List</b>\n\nOrder မရှိသေးပါ။', mainMenuKeyboard());
  }

  const lines = orders.map((order, index) => {
    return (
      `${index + 1}. <code>${h(order.orderId)}</code>\n` +
      `   ${h(order.botName)} / ${h(order.rarityLabel)}\n` +
      `   Price: <b>${money(order.price)}</b>\n` +
      `   Status: <b>${h(order.status)}</b>`
    );
  });

  return editHtml(
    ctx,
    '📋 <b>My Sell List</b>\n━━━━━━━━━━━━━━\n' + lines.join('\n\n'),
    keyboard([[cb('⬅️ Back', 'sell:menu', 'danger')]])
  );
}

module.exports = (bot) => {
  sellService.ensureSellIndexes().catch((err) => {
    console.error('Sell index ensure failed:', err?.message || err);
  });

  bot.command('sellon', async (ctx) => {
    if (!isSellOwner(ctx)) {
      return replyHtml(ctx, '❌ Owner only command ပါ။');
    }

    await setSellEnabled(true, ctx.from?.id);

    return replyHtml(
      ctx,
      '✅ <b>Sell System ON</b>\n\nUser တွေ <code>/sell</code> ကို ပြန်အသုံးပြုနိုင်ပါပြီ။'
    );
  });

  bot.command('selloff', async (ctx) => {
    if (!isSellOwner(ctx)) {
      return replyHtml(ctx, '❌ Owner only command ပါ။');
    }

    await setSellEnabled(false, ctx.from?.id);

    return replyHtml(
      ctx,
      '⛔ <b>Sell System OFF</b>\n\nUser တွေ <code>/sell</code> အသုံးပြုလို့မရတော့ပါ။ Owner ကတော့ ဆက်သုံးနိုင်ပါတယ်။'
    );
  });

  bot.command('sell', async (ctx) => {
    clearPending(ctx);

    if (!(await canUseSellSystem(ctx))) {
      return replyHtml(ctx, sellDisabledText());
    }

    if (!isPrivateChat(ctx)) {
      return replyHtml(ctx, dmOnlyText(), dmOnlyKeyboard(ctx, bot));
    }

    return replyHtml(ctx, sellMenuText(), mainMenuKeyboard());
  });

  bot.command('sellpriceadd', async (ctx) => {
    if (!sellService.isOwner(ctx.from?.id)) {
      return replyHtml(ctx, '❌ Owner only command ပါ။');
    }

    const parts = String(ctx.message?.text || '').trim().split(/\s+/);

    if (parts.length < 4) {
      return replyHtml(
        ctx,
        'အသုံးပြုပုံမှားနေပါတယ်။\n\n' +
          '<code>/sellpriceadd catchbot legendary 10000</code>\n' +
          '<code>/sellpriceadd hallowbot eldritch 100000</code>\n' +
          '<code>/sellpriceadd yelan common 5000</code>\n' +
          '<code>/sellpriceadd bika divine 300000</code>'
      );
    }

    const botInput = parts[1];
    const rarityInput = parts[2];
    const priceInput = parts[3];

    try {
      const result = await sellService.setPrice(botInput, rarityInput, priceInput, ctx.from.id);

      return replyHtml(
        ctx,
        '✅ <b>Sell Price Updated</b>\n\n' +
          `Bot: <b>${h(result.botName)}</b>\n` +
          `Rarity: <b>${h(result.rarityLabel)}</b>\n` +
          `Price: <b>${money(result.price)}</b>`
      );
    } catch (err) {
      return replyHtml(
        ctx,
        '❌ Price မသတ်မှတ်နိုင်ပါ။\n\n' +
          'မှန်ကန်တဲ့ command ဥပမာ:\n' +
          '<code>/sellpriceadd catchbot legendary 10000</code>\n' +
          '<code>/sellpriceadd hallowbot oblivion 300000</code>\n' +
          '<code>/sellpriceadd yelan crossverse 1000000</code>\n' +
          '<code>/sellpriceadd bika mystical 100000</code>'
      );
    }
  });

  bot.action('sell:menu', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await requireSellSystemAvailable(ctx))) return;
    clearPending(ctx);
    return editHtml(ctx, sellMenuText(), mainMenuKeyboard());
  });

  bot.action('sell:help', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await requireSellSystemAvailable(ctx))) return;
    return editHtml(ctx, helpText(), keyboard([[cb('⬅️ Back', 'sell:menu', 'danger')]]));
  });

  bot.action('sell:my', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await requireSellSystemAvailable(ctx))) return;
    return showMyOrders(ctx);
  });

  bot.action(/^sell:bot:([a-z0-9_]+)$/i, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await requireSellSystemAvailable(ctx))) return;
    clearPending(ctx);

    const botKey = ctx.match[1];
    if (!SELL_BOTS[botKey]) return editHtml(ctx, '❌ Bot type မတွေ့ပါ။', mainMenuKeyboard());

    return editHtml(ctx, rarityText(botKey), rarityKeyboard(botKey));
  });

  bot.action(/^sell:rarity:([a-z0-9_]+):([a-z0-9_]+)$/i, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    if (!(await requireSellSystemAvailable(ctx))) return;
    clearPending(ctx);

    const botKey = ctx.match[1];
    const rarityKey = ctx.match[2];

    return editHtml(ctx, await priceText(botKey, rarityKey), confirmKeyboard(botKey, rarityKey));
  });

  bot.action(/^sell:yes:([a-z0-9_]+):([a-z0-9_]+)$/i, async (ctx) => {
    await ctx.answerCbQuery('Gift link ပို့ပါ').catch(() => {});
    if (!(await requireSellSystemAvailable(ctx))) return;

    const botKey = ctx.match[1];
    const rarityKey = ctx.match[2];
    const price = await sellService.getPrice(botKey, rarityKey);

    if (!price) {
      return editHtml(ctx, '❌ Price မတွေ့ပါ။', mainMenuKeyboard());
    }

    setPending(ctx, { botKey, rarityKey });

    return editHtml(
      ctx,
      '🎁 <b>Gift Link ပို့ရန်</b>\n' +
        '━━━━━━━━━━━━━━\n' +
        `Bot: <b>${h(price.botName)}</b>\n` +
        `Rarity: <b>${h(price.rarityLabel)}</b>\n` +
        `Price: <b>${money(price.price)}</b>\n\n` +
        `${h(GIFT_INSTRUCTION_LINK)}\n` +
        'ဒီ Link ကစာကိုထောက်ပြီး <b>Gift</b> ပါ။\n\n' +
        'Gift ပြီးသွားတဲ့စာရဲ့ link ကို copy ယူပြီး ဒီ chat ထဲမှာ ပို့ပေးပါ။\n\n' +
        '⏳ Link ပို့ရန် 10 minutes အတွင်းပို့ပါ။',
      keyboard([[cb('⬅️ Back to Rarity', `sell:bot:${botKey}`, 'danger')]])
    );
  });

  bot.on('text', async (ctx, next) => {
    const pending = getPending(ctx);
    if (!pending) return next();

    if (!(await canUseSellSystem(ctx))) {
      clearPending(ctx);
      return replyHtml(ctx, sellDisabledText());
    }

    const text = String(ctx.message?.text || '').trim();

    if (!sellService.isTelegramGiftLink(text)) {
      return replyHtml(
        ctx,
        '⚠️ Gift message link မမှန်ပါ။\n\n' +
          'ဥပမာ: <code>https://t.me/WaifuCheatBotChat/431645</code>\n\n' +
          'မလုပ်တော့ဘူးဆိုရင် <code>/sell</code> ပြန်စပါ။'
      );
    }

    try {
      const order = await sellService.createSellOrder({
        seller: ctx.from,
        botKey: pending.botKey,
        rarityKey: pending.rarityKey,
        giftLink: text,
      });

      clearPending(ctx);

      const ownerAlertSent = await notifyOwners(ctx, order);

      return replyHtml(ctx, orderCreatedText(order, ownerAlertSent));
    } catch (err) {
      if (err?.message === 'DUPLICATE_GIFT_LINK') {
        clearPending(ctx);
        return replyHtml(ctx, '❌ ဒီ Gift Link နဲ့ order တင်ပြီးသားရှိပါတယ်။');
      }

      if (err?.message === 'GIFT_LINK_INVALID') {
        return replyHtml(ctx, '⚠️ Gift link format မမှန်ပါ။ Telegram message link ပို့ပါ။');
      }

      return replyHtml(ctx, `❌ Order မတင်နိုင်ပါ။\nReason: <code>${h(err?.message || err)}</code>`);
    }
  });

  bot.action(/^sell:owner:(approve|cancel):([A-Z0-9-]+)$/i, async (ctx) => {
    const action = String(ctx.match[1]).toLowerCase();
    const orderId = ctx.match[2];

    if (!sellService.isOwner(ctx.from?.id)) {
      await ctx.answerCbQuery('Owner only', { show_alert: true }).catch(() => {});
      return;
    }

    await ctx.answerCbQuery('Processing...').catch(() => {});

    try {
      if (action === 'approve') {
        const result = await sellService.approveOrder(orderId, ctx.from.id);

        if (!result.ok) {
          return editHtml(ctx, `⚠️ ${h(result.reason)}`);
        }

        await editHtml(ctx, finalOwnerText(result.order, 'APPROVED'));

        try {
          await ctx.telegram.sendMessage(result.order.sellerId, userApprovedText(result.order), {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          });
        } catch (_) {}

        return;
      }

      const result = await sellService.cancelOrder(orderId, ctx.from.id);

      if (!result.ok) {
        return editHtml(ctx, `⚠️ ${h(result.reason)}`);
      }

      await editHtml(ctx, finalOwnerText(result.order, 'CANCELLED'));

      try {
        await ctx.telegram.sendMessage(result.order.sellerId, userCancelledText(result.order), {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
      } catch (_) {}
    } catch (err) {
      return editHtml(
        ctx,
        '❌ Owner action failed.\n\n' +
          `Order ID: <code>${h(orderId)}</code>\n` +
          `Reason: <code>${h(err?.message || err)}</code>`
      );
    }
  });
};
