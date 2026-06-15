'use strict';

const { COIN } = require('../../config/constants');
const { getTopUsers } = require('../../services/rankingService');
const { replyHTML } = require('../../utils/telegram');
const { fmt, formatYangon } = require('../../utils/format');
const { userDocLabelHtml, isGroupChat } = require('../../utils/helpers');
const { topBadge, getBalanceRank } = require('../../utils/ranking');

function h(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<a\s+[^>]*>(.*?)<\/a>/gis, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
}

function truncate(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function pad(value, width, align = 'left') {
  const text = truncate(String(value || ''), width);
  const size = Math.max(0, width - text.length);

  if (align === 'right') return `${' '.repeat(size)}${text}`;
  return `${text}${' '.repeat(size)}`;
}

function rankLabel(index) {
  if (index === 0) return '🥇 1';
  if (index === 1) return '🥈 2';
  if (index === 2) return '🥉 3';
  return `#${index + 1}`;
}

function playerHtml(user) {
  return userDocLabelHtml(user);
}

function playerPlain(user) {
  return stripHtml(userDocLabelHtml(user)) || `User ${user.userId || user.id || ''}`.trim();
}

function buildRichTop10Html(list, updatedAt) {
  const rows = list.map((user, index) => {
    const balance = Number(user.balance || 0);
    const balanceRank = getBalanceRank(balance);

    return (
      '<tr>' +
        `<td align="center"><b>${h(rankLabel(index))}</b></td>` +
        `<td>${balanceRank?.badge ? `${h(balanceRank.badge)} ` : ''}${playerHtml(user)}</td>` +
        `<td align="right"><b>${h(fmt(balance))}</b> ${h(COIN)}</td>` +
      '</tr>'
    );
  }).join('');

  return (
    '<h2>🏆 BIKA TOP 10 PLAYERS</h2>' +
    '<table bordered striped>' +
      '<caption>Game Coin Leaderboard</caption>' +
      '<tr>' +
        '<th align="center">Rank</th>' +
        '<th align="left">Player</th>' +
        '<th align="right">Balance</th>' +
      '</tr>' +
      rows +
    '</table>' +
    `<footer>🕒 ${h(formatYangon(updatedAt))} (Yangon Time)</footer>`
  );
}

function buildFallbackTop10Html(list, updatedAt) {
  const lines = list.map((user, index) => {
    const balance = Number(user.balance || 0);
    const badge = getBalanceRank(balance)?.badge || '';
    return `${topBadge(index)} <b>#${index + 1}</b> ${h(badge)} ${playerHtml(user)} — <b>${fmt(balance)}</b> ${COIN}`;
  });

  const tableLines = [
    `${pad('Rank', 6)} ${pad('Player', 18)} ${pad('Balance', 14, 'right')}`,
    `${pad('────', 6)} ${pad('────────────', 18)} ${pad('────────', 14, 'right')}`,
    ...list.map((user, index) => (
      `${pad(rankLabel(index), 6)} ${pad(playerPlain(user), 18)} ${pad(fmt(Number(user.balance || 0)), 14, 'right')}`
    )),
  ];

  return (
    '📊 <b>BIKA • Top 10 Players</b>\n' +
    '━━━━━━━━━━━━━━━━\n' +
    `${lines.join('\n')}\n` +
    '━━━━━━━━━━━━━━━━\n' +
    `<pre>${h(tableLines.join('\n'))}</pre>\n` +
    '━━━━━━━━━━━━━━━\n' +
    `🕒 ${formatYangon(updatedAt)} (Yangon Time)`
  );
}

async function sendRichTop10(ctx, list, updatedAt) {
  const payload = {
    chat_id: ctx.chat.id,
    rich_message: {
      html: buildRichTop10Html(list, updatedAt),
      skip_entity_detection: true,
    },
  };

  if (ctx.message?.message_id) {
    payload.reply_parameters = {
      message_id: ctx.message.message_id,
      allow_sending_without_reply: true,
    };
  }

  return ctx.telegram.callApi('sendRichMessage', payload);
}

async function send(ctx) {
  const list = await getTopUsers(10);

  if (!list.length) {
    return replyHTML(ctx, '📊 Top10 မရှိသေးပါ။');
  }

  const updatedAt = new Date();

  try {
    return await sendRichTop10(ctx, list, updatedAt);
  } catch (err) {
    console.warn('TOP10_RICH_TABLE_FALLBACK:', err?.message || err);
    return replyHTML(ctx, buildFallbackTop10Html(list, updatedAt));
  }
}

module.exports = (bot) => {
  bot.command('top10', send);

  bot.hears(/^\.(top10)(\s+players)?\s*$/i, async (ctx) => {
    if (!isGroupChat(ctx)) {
      return replyHTML(ctx, 'ℹ️ <code>.top10</code> ကို group ထဲမှာပဲ သုံးနိုင်ပါတယ်။');
    }

    return send(ctx);
  });
};
