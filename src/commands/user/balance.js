'use strict';

const { COIN } = require('../../config/constants');
const { getUser } = require('../../services/economyService');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { mentionHtml } = require('../../utils/helpers');

function balanceText(ctx, user) {
  const balance = Number(user?.balance || 0);
  const totalWon = Number(user?.totalWon || 0);
  const totalLost = Number(user?.totalLost || 0);
  const isVip = Boolean(user?.isVip);

  return (
    `💼 <b>BIKA Wallet</b>\n` +
    `━━━━━━━━━━━━━━\n` +
    `👤 ${mentionHtml(ctx.from)}\n` +
    `💰 Balance: <b>${fmt(balance)}</b> ${COIN}\n` +
    `🏆 Total Won: <b>${fmt(totalWon)}</b> ${COIN}\n` +
    `💸 Total Lost: <b>${fmt(totalLost)}</b> ${COIN}\n` +
    `⭐ VIP: <b>${isVip ? 'YES' : 'NO'}</b>\n` +
    `━━━━━━━━━━━━━━`
  );
}

module.exports = (bot) => {
  async function sendBalance(ctx) {
    const user = await getUser(ctx.from.id);

    return replyHTML(ctx, balanceText(ctx, user));
  }

  // Slash commands
  bot.command('bal', sendBalance);
  bot.command('balance', sendBalance);
  bot.command('mybalance', sendBalance);

  // Dot commands
  bot.hears(/^\.(bal|balance|mybalance)\s*$/i, sendBalance);
};
