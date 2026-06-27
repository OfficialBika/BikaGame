'use strict';

const { COIN } = require('../../config/constants');
const { getDailyTournament, yangonDayKey } = require('../../services/tournamentService');
const { replyHTML } = require('../../utils/telegram');
const { fmt, formatYangon } = require('../../utils/format');
const { userDocLabelHtml, isGroupChat } = require('../../utils/helpers');

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

function playerHtml(row) {
  return userDocLabelHtml(row);
}

function playerPlain(row) {
  return stripHtml(userDocLabelHtml(row)) || `User ${row.userId || ''}`.trim();
}

function buildRichHtml(list, updatedAt) {
  const rows = list.map((row, index) => (
    '<tr>' +
      `<td align="center"><b>${h(rankLabel(index))}</b></td>` +
      `<td>${playerHtml(row)}</td>` +
      `<td align="right"><b>${h(fmt(row.score || 0))}</b> ${h(COIN)}</td>` +
      `<td align="right">${h(fmt(row.bestWin || 0))}</td>` +
      `<td align="center">${h(fmt(row.games || 0))}</td>` +
    '</tr>'
  )).join('');

  return (
    '<h2>🏆 BIKA DAILY MINES TOURNAMENT</h2>' +
    '<table bordered striped>' +
      `<caption>${h(yangonDayKey(updatedAt))} • Group Daily Ranking</caption>` +
      '<tr>' +
        '<th align="center">Rank</th>' +
        '<th align="left">Player</th>' +
        '<th align="right">Profit</th>' +
        '<th align="right">Best</th>' +
        '<th align="center">Games</th>' +
      '</tr>' +
      rows +
    '</table>' +
    `<footer>🕒 ${h(formatYangon(updatedAt))} (Yangon Time)</footer>`
  );
}

function buildFallbackHtml(list, updatedAt) {
  const tableLines = [
    `${pad('Rank', 6)} ${pad('Player', 16)} ${pad('Profit', 12, 'right')} ${pad('Best', 10, 'right')} ${pad('G', 3, 'right')}`,
    `${pad('────', 6)} ${pad('────────────', 16)} ${pad('──────', 12, 'right')} ${pad('────', 10, 'right')} ${pad('─', 3, 'right')}`,
    ...list.map((row, index) => (
      `${pad(rankLabel(index), 6)} ${pad(playerPlain(row), 16)} ${pad(fmt(row.score || 0), 12, 'right')} ${pad(fmt(row.bestWin || 0), 10, 'right')} ${pad(fmt(row.games || 0), 3, 'right')}`
    )),
  ];

  return (
    '🏆 <b>BIKA Daily Mines Tournament</b>\n' +
    `📅 <b>${yangonDayKey(updatedAt)}</b> • Group Ranking\n` +
    '━━━━━━━━━━━━━━━━\n' +
    `<pre>${h(tableLines.join('\n'))}</pre>\n` +
    '━━━━━━━━━━━━━━━━\n' +
    `🕒 ${formatYangon(updatedAt)} (Yangon Time)`
  );
}

async function sendRichTournament(ctx, list, updatedAt) {
  const payload = {
    chat_id: ctx.chat.id,
    rich_message: {
      html: buildRichHtml(list, updatedAt),
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

async function sendTournament(ctx) {
  if (!isGroupChat(ctx)) {
    return replyHTML(ctx, 'ℹ️ Daily tournament list ကို group ထဲမှာပဲ ကြည့်နိုင်ပါတယ်။');
  }

  const updatedAt = new Date();
  const list = await getDailyTournament({
    game: 'mines',
    chatId: ctx.chat.id,
    limit: 10,
  });

  if (!list.length) {
    return replyHTML(
      ctx,
      '🏆 <b>BIKA Daily Mines Tournament</b>\n' +
        '━━━━━━━━━━━━━━━━\n' +
        'ဒီနေ့ tournament record မရှိသေးပါ။\n' +
        'စတင်ရန်: <code>.mines 1000</code>'
    );
  }

  try {
    return await sendRichTournament(ctx, list, updatedAt);
  } catch (err) {
    console.warn('DAILY_TOURNAMENT_RICH_FALLBACK:', err?.message || err);
    return replyHTML(ctx, buildFallbackHtml(list, updatedAt));
  }
}

module.exports = (bot) => {
  bot.command('dailytournament', sendTournament);
  bot.command('tournament', sendTournament);
  bot.command('minestop', sendTournament);

  bot.hears(/^\.(dailytournament|tournament|tour|dt|minestop)\s*$/i, sendTournament);
};
