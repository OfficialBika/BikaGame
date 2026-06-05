'use strict';

const { COIN } = require('../../config/constants');
const { getUser } = require('../../services/economyService');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { mentionHtml } = require('../../utils/helpers');

function getBalanceRankLabel(balance) {
  const amount = Number(balance || 0);

  if (amount >= 10000000) return 'ဘုရင်တန်းစား 👑';
  if (amount >= 5000000) return 'အထက်တန်းစား 💎';
  if (amount >= 1000000) return 'သူဌေးတန်းစား 🏆';
  if (amount >= 500000) return 'အလယ်အထက်တန်းစား ⭐';
  if (amount >= 100000) return 'လူလတ်တန်းစား 🏷️';
  if (amount >= 50000) return 'အခြေခံတန်းစား 💼';
  if (amount >= 10000) return 'စတင်တက်လာသူ 🌱';

  return 'စတင်သူ 🐣';
}

function balanceText(ctx, user) {
  const balance = Number(user?.balance || 0);
  const totalWon = Number(user?.totalWon || 0);
  const totalLost = Number(user?.totalLost || 0);
  const isVip = Boolean(user?.isVip);
  const rankLabel = getBalanceRankLabel(balance);

  return (
    `💼 <b>BIKA Wallet</b>\n` +
    `━━━━━━━━━━━━━━\n` +
    `👤 ${mentionHtml(ctx.from)}\n` +
    `💰 Balance: <b>${fmt(balance)}</b> ${COIN}\n` +
    `🏆 Total Won: <b>${fmt(totalWon)}</b> ${COIN}\n` +
    `💸 Total Lost: <b>${fmt(totalLost)}</b> ${COIN}\n` +
    `🏷️ Rank: <b>${rankLabel}</b>\n` +
    `⭐ VIP: <b>${isVip ? 'YES' : 'NO'}</b>\n` +
    `━━━━━━━━━━━━━━`
  );
}

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;

  return messageId
    ? { reply_to_message_id: messageId }
    : {};
}

module.exports = (bot) => {
  async function sendBalance(ctx) {
    const user = await getUser(ctx.from.id);

    return replyHTML(
      ctx,
      balanceText(ctx, user),
      replyOptions(ctx)
    );
  }

  bot.command('bal', sendBalance);
  bot.command('balance', sendBalance);
  bot.command('mybalance', sendBalance);

  bot.hears(/^\.(bal|balance|mybalance)\s*$/i, sendBalance);
};

module.exports.getBalanceRankLabel = getBalanceRankLabel;
