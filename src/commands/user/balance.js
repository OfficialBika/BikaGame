'use strict';

const { COIN } = require('../../config/constants');
const { getUser } = require('../../services/economyService');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { mentionHtml } = require('../../utils/helpers');
const { getBalanceRank } = require('../../utils/ranking');
const { getBotInfo } = require('../../config/bot');
const { getWallet } = require('../../services/walletService');
const {
  STAR_TO_BAL,
  PACKAGES,
  packageBal,
  payloadFor,
  parsePayload,
  creditSuccessfulPayment,
} = require('../../services/starsBalanceService');

const pendingInvoices = new Set();

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId, allow_sending_without_reply: true } : {};
}

function ownerId(ctx, explicitOwnerId) {
  return String(explicitOwnerId || ctx.from?.id || '');
}

function ownerCallback(action, userId) {
  return action + ':' + String(userId);
}

async function payKeyboard(ctx) {
  const userId = ownerId(ctx);
  const username = String(getBotInfo()?.username || process.env.BOT_USERNAME || '').replace(/^@/, '');
  const rows = [];

  if (username && userId) {
    const wallet = await getWallet(ctx.from.id);
    if (wallet?.walletId) {
      const deep = 'https://t.me/' + username + '?startapp=' + encodeURIComponent('pay_' + wallet.walletId);
      rows.push([{ text: '💸 Pay Bal', style: 'primary', url: deep }]);
    }
  }

  // Keep Stars purchase available even if a wallet deep link is not configured.
  rows.push([{ text: '⭐ Bal ဝယ်ရန်', style: 'success', callback_data: ownerCallback('bal:buy', userId) }]);
  return { inline_keyboard: rows };
}

function balanceText(ctx, user) {
  const balance = Number(user?.balance || 0);
  const totalWon = Number(user?.totalWon || 0);
  const totalLost = Number(user?.totalLost || 0);
  const rank = getBalanceRank(user?.balance);

  return [
    rank.badge + ' <b>BIKA Wallet</b>',
    '━━━━━━━━━━━━━━',
    '👤 ' + mentionHtml(ctx.from),
    '💰 Balance: <b>' + fmt(balance) + '</b> ' + COIN,
    '🏆 Total Won: <b>' + fmt(totalWon) + '</b> ' + COIN,
    '💸 Total Lost: <b>' + fmt(totalLost) + '</b> ' + COIN,
    '🏷️ Rank: <b>' + rank.title + '</b>',
    '━━━━━━━━━━━━━━',
  ].join('\n');
}

async function sendBalance(ctx) {
  const user = await getUser(ctx.from.id);
  const keyboard = await payKeyboard(ctx);
  return replyHTML(ctx, balanceText(ctx, user), {
    ...replyOptions(ctx),
    reply_markup: keyboard,
  });
}

function packageKeyboard(userId) {
  const rowFor = (packages) => packages.map((stars) => ({
    text: '⭐ ' + stars + ' Stars → ' + fmt(packageBal(stars)) + ' Bal',
    callback_data: ownerCallback('bal:confirm:' + stars, userId),
  }));

  return {
    inline_keyboard: [
      rowFor([10, 20, 30]),
      rowFor([40, 50, 100]),
      [
        { text: '📜 Terms', callback_data: ownerCallback('bal:terms:packages', userId) },
        { text: '🆘 Payment Support', callback_data: ownerCallback('bal:support', userId) },
      ],
      [{ text: '⬅️ Back to Balance', callback_data: ownerCallback('bal:back:balance', userId) }],
    ],
  };
}

function packageText() {
  return [
    '⭐ <b>BIKA Bal Purchase</b>',
    '━━━━━━━━━━━━━━',
    'Exchange rate: <b>1 Star = ' + fmt(STAR_TO_BAL) + ' Bal</b>',
    '',
    'Choose a package below. Payment is processed securely through Telegram Stars.',
    '',
    '<b>Packages</b>',
    PACKAGES.map((stars) => '⭐ ' + stars + ' Stars → <b>' + fmt(packageBal(stars)) + ' Bal</b>').join('\n'),
    '━━━━━━━━━━━━━━',
  ].join('\n');
}

function confirmText(stars) {
  return [
    '⭐ <b>Confirm Bal Purchase</b>',
    '━━━━━━━━━━━━━━',
    'Package: <b>' + stars + ' Stars</b>',
    'You receive: <b>' + fmt(packageBal(stars)) + ' Bal</b>',
    'Rate: <b>1 Star = ' + fmt(STAR_TO_BAL) + ' Bal</b>',
    '',
    'Please review the purchase terms before continuing.',
  ].join('\n');
}

function confirmKeyboard(stars, userId) {
  return {
    inline_keyboard: [
      [{ text: '📜 Read Terms', callback_data: ownerCallback('bal:terms:confirm:' + stars, userId) }],
      [{ text: '✅ I Agree & Pay ' + stars + ' Stars', style: 'success', callback_data: ownerCallback('bal:invoice:' + stars, userId) }],
      [{ text: '⬅️ Back to Packages', callback_data: ownerCallback('bal:back:packages', userId) }],
    ],
  };
}

function backToPackagesKeyboard(userId) {
  return {
    inline_keyboard: [
      [{ text: '⬅️ Back to Packages', callback_data: ownerCallback('bal:back:packages', userId) }],
    ],
  };
}

async function answerCallback(ctx, text, showAlert) {
  try {
    await ctx.answerCbQuery(text, showAlert ? { show_alert: true } : undefined);
  } catch (_) {
    // The callback can already be answered if Telegram delivers duplicate taps.
  }
}

async function editScreen(ctx, text, keyboard) {
  try {
    return await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: keyboard,
    });
  } catch (err) {
    const description = String(err?.description || err?.message || '');
    if (/message is not modified/i.test(description)) return null;
    throw err;
  }
}

async function assertMenuOwner(ctx, requestedOwnerId) {
  const expected = String(requestedOwnerId || ctx.from?.id || '');
  if (expected !== String(ctx.from?.id || '')) {
    await answerCallback(ctx, 'This menu belongs to another user.', true);
    return false;
  }
  return true;
}

async function showPackages(ctx, requestedOwnerId) {
  const userId = ownerId(ctx, requestedOwnerId);
  if (!(await assertMenuOwner(ctx, userId))) return;
  await answerCallback(ctx);
  return editScreen(ctx, packageText(), packageKeyboard(userId));
}

async function backToBalance(ctx, requestedOwnerId) {
  const userId = ownerId(ctx, requestedOwnerId);
  if (!(await assertMenuOwner(ctx, userId))) return;
  await answerCallback(ctx);
  const user = await getUser(ctx.from.id);
  return editScreen(ctx, balanceText(ctx, user), await payKeyboard(ctx));
}

async function confirmPackage(ctx, stars, requestedOwnerId) {
  const userId = ownerId(ctx, requestedOwnerId);
  if (!(await assertMenuOwner(ctx, userId))) return;
  if (!Number.isInteger(stars) || !PACKAGES.includes(stars)) {
    await answerCallback(ctx, 'Invalid package.', true);
    return;
  }
  await answerCallback(ctx);
  return editScreen(ctx, confirmText(stars), confirmKeyboard(stars, userId));
}

function termsText() {
  return [
    '<b>BIKA Bal Purchase Terms</b>',
    '',
    'Telegram Stars are used to purchase digital Bal inside BIKA.',
    'Bal is credited only after Telegram sends a successful payment confirmation.',
    'For payment problems, use /paysupport.',
    '',
    'Please confirm the amount shown on Telegram’s payment screen before paying.',
  ].join('\n');
}

async function answerTerms(ctx, source, stars, requestedOwnerId) {
  const userId = ownerId(ctx, requestedOwnerId);
  if (!(await assertMenuOwner(ctx, userId))) return;
  await answerCallback(ctx);
  const back = source === 'confirm' && PACKAGES.includes(Number(stars))
    ? [{ text: '⬅️ Back to Confirmation', callback_data: ownerCallback('bal:back:confirm:' + Number(stars), userId) }]
    : [{ text: '⬅️ Back to Packages', callback_data: ownerCallback('bal:back:packages', userId) }];

  return editScreen(ctx, termsText(), { inline_keyboard: [back] });
}

async function answerSupport(ctx, requestedOwnerId) {
  const userId = ownerId(ctx, requestedOwnerId);
  if (!(await assertMenuOwner(ctx, userId))) return;
  await answerCallback(ctx);
  const text = [
    '🆘 <b>Payment Support</b>',
    '',
    'If your Stars payment succeeded but Bal was not credited, keep the Telegram payment receipt and contact BIKA support.',
    'Never send your Telegram login code or bot token.',
    '',
    'You can return to the purchase packages below.',
  ].join('\n');
  return editScreen(ctx, text, {
    inline_keyboard: [
      [{ text: '⬅️ Back to Packages', callback_data: ownerCallback('bal:back:packages', userId) }],
    ],
  });
}

async function sendStarsInvoice(ctx, stars, requestedOwnerId) {
  const userId = ownerId(ctx, requestedOwnerId);
  if (!(await assertMenuOwner(ctx, userId))) return;
  if (!Number.isInteger(stars) || !PACKAGES.includes(stars)) {
    await answerCallback(ctx, 'Invalid package.', true);
    return;
  }

  const screenMessageId = Number(ctx.callbackQuery?.message?.message_id);
  const lockKey = [ctx.chat?.id, screenMessageId, userId, stars].join(':');
  if (pendingInvoices.has(lockKey)) {
    await answerCallback(ctx, 'Your invoice is already being prepared.');
    return;
  }

  pendingInvoices.add(lockKey);
  await answerCallback(ctx);

  const bal = packageBal(stars);
  try {
    // Remove the pay callback before creating the invoice to prevent rapid repeated taps.
    await editScreen(
      ctx,
      '⏳ <b>Preparing your Stars invoice…</b>\n\nPlease wait. Your balance will only change after Telegram confirms payment.',
      { inline_keyboard: [] },
    );

    try {
      await ctx.replyWithInvoice({
        title: 'BIKA ' + stars + ' Stars Bal Package',
        description: 'Purchase ' + fmt(bal) + ' Bal with ' + stars + ' Telegram Stars. Exchange rate: 1 Star = ' + fmt(STAR_TO_BAL) + ' Bal.',
        payload: payloadFor(stars, ctx.from.id, screenMessageId),
        currency: 'XTR',
        prices: [{ label: fmt(bal) + ' Bal', amount: stars }],
        provider_token: '',
        start_parameter: 'bal_' + stars,
        reply_markup: {
          inline_keyboard: [[{ text: '⭐ Pay ' + stars + ' Stars', pay: true }]],
        },
      });
    } catch (err) {
      await editScreen(ctx, confirmText(stars), confirmKeyboard(stars, userId)).catch(() => {});
      throw err;
    }

    return await editScreen(
      ctx,
      '🧾 <b>Stars invoice created</b>\n\nComplete the payment using the Telegram invoice message. Bal is credited only after Telegram confirms the payment.',
      backToPackagesKeyboard(userId),
    );
  } finally {
    pendingInvoices.delete(lockKey);
  }
}

async function showPaymentResult(ctx, parsed, statusText) {
  const user = await getUser(ctx.from.id);
  const keyboard = await payKeyboard(ctx);
  const text = balanceText(ctx, user) + '\n\n' + statusText;

  if (parsed?.screenMessageId && ctx.chat?.id) {
    try {
      await ctx.telegram.editMessageText(
        ctx.chat.id,
        parsed.screenMessageId,
        undefined,
        text,
        { parse_mode: 'HTML', reply_markup: keyboard },
      );
      return;
    } catch (err) {
      const description = String(err?.description || err?.message || '');
      if (/message is not modified/i.test(description)) return;
      // The screen may have been deleted or become uneditable; fall back to a receipt notice.
    }
  }

  return ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
}

function registerStarsHandlers(bot) {
  // New callbacks carry the screen owner's Telegram ID; older buttons remain supported during rollout.
  bot.action(/^bal:buy(?::(\d+))?$/, async (ctx) => {
    const target = ctx.match[1] || ctx.from.id;
    return showPackages(ctx, target);
  });

  bot.action(/^bal:confirm:(10|20|30|40|50|100)(?::(\d+))?$/, async (ctx) => {
    const target = ctx.match[2] || ctx.from.id;
    return confirmPackage(ctx, Number(ctx.match[1]), target);
  });

  bot.action(/^bal:invoice:(10|20|30|40|50|100)(?::(\d+))?$/, async (ctx) => {
    const target = ctx.match[2] || ctx.from.id;
    return sendStarsInvoice(ctx, Number(ctx.match[1]), target);
  });

  bot.action(/^bal:terms:packages(?::(\d+))?$/, async (ctx) => {
    return answerTerms(ctx, 'packages', null, ctx.match[1] || ctx.from.id);
  });

  bot.action(/^bal:terms:confirm:(10|20|30|40|50|100):(\d+)$/, async (ctx) => {
    return answerTerms(ctx, 'confirm', Number(ctx.match[1]), ctx.match[2]);
  });

  bot.action('bal:terms', (ctx) => answerTerms(ctx, 'packages', null, ctx.from.id));

  bot.action(/^bal:support(?::(\d+))?$/, async (ctx) => {
    return answerSupport(ctx, ctx.match[1] || ctx.from.id);
  });

  bot.action(/^bal:back:balance(?::(\d+))?$/, async (ctx) => {
    return backToBalance(ctx, ctx.match[1] || ctx.from.id);
  });

  bot.action(/^bal:back:packages(?::(\d+))?$/, async (ctx) => {
    return showPackages(ctx, ctx.match[1] || ctx.from.id);
  });

  bot.action(/^bal:back:confirm:(10|20|30|40|50|100):(\d+)$/, async (ctx) => {
    return confirmPackage(ctx, Number(ctx.match[1]), ctx.match[2]);
  });

  // Retain compatibility with messages from the previous confirmation screen.
  bot.action('bal:cancel', (ctx) => showPackages(ctx, ctx.from.id));

  bot.on('pre_checkout_query', async (ctx) => {
    const query = ctx.update.pre_checkout_query;
    const parsed = parsePayload(query.invoice_payload);
    const valid = parsed
      && String(parsed.userId) === String(ctx.from.id)
      && query.currency === 'XTR'
      && Number(query.total_amount) === parsed.stars
      && Number(query.total_amount) > 0;

    if (!valid) {
      return ctx.answerPreCheckoutQuery(false, 'Invalid or expired Bal purchase. Please start again.');
    }
    return ctx.answerPreCheckoutQuery(true);
  });

  bot.on('successful_payment', async (ctx) => {
    const payment = ctx.message?.successful_payment;
    if (!payment) return;

    const parsed = parsePayload(payment.invoice_payload);
    if (!parsed
      || payment.currency !== 'XTR'
      || Number(payment.total_amount) !== parsed.stars
      || String(parsed.userId) !== String(ctx.from.id)) {
      return ctx.reply('⚠️ Payment received, but the purchase data could not be verified. Please contact /paysupport with your receipt.');
    }

    try {
      const result = await creditSuccessfulPayment({
        userId: ctx.from.id,
        stars: parsed.stars,
        bal: packageBal(parsed.stars),
        chargeId: payment.telegram_payment_charge_id,
        payload: payment.invoice_payload,
      });

      if (result.duplicate) {
        return showPaymentResult(
          ctx,
          parsed,
          'ℹ️ <b>This payment was already processed.</b> No additional Bal was added.',
        );
      }

      return showPaymentResult(
        ctx,
        parsed,
        '✅ <b>Bal Purchase Successful</b>\n⭐ Stars paid: <b>' + parsed.stars + '</b>\n💰 Added: <b>' + fmt(result.bal) + '</b> Bal\n📊 Rate: <b>1 Star = ' + fmt(STAR_TO_BAL) + ' Bal</b>',
      );
    } catch (_) {
      return ctx.reply('⚠️ Payment was received, but Bal credit is temporarily pending. Please use /paysupport and include your Telegram payment receipt.');
    }
  });

  bot.command('terms', (ctx) => ctx.reply(
    '<b>BIKA Terms</b>\n\nBal purchased with Telegram Stars is a digital in-bot balance. Purchases are credited after Telegram confirms successful payment. Contact /paysupport for payment issues.',
    { parse_mode: 'HTML' },
  ));

  bot.command('paysupport', (ctx) => ctx.reply(
    '🆘 <b>Payment Support</b>\n\nFor a missing or incorrect Bal credit, send your Telegram payment receipt and charge ID to BIKA support. Do not send passwords, login codes, or bot tokens.',
    { parse_mode: 'HTML' },
  ));
}

module.exports = (bot) => {
  bot.command(['bal', 'balance', 'mybalance'], sendBalance);
  bot.hears(/^\.(bal|balance|mybalance)\s*$/i, sendBalance);
  registerStarsHandlers(bot);
};

module.exports.getBalanceRankLabel = () => '';
