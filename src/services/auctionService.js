'use strict';

const { col, withRequiredTx, safeCreateIndex } = require('../config/database');
const userModel = require('../models/userModel');
const { ensureTreasury } = require('./treasuryService');
const treasuryModel = require('../models/treasuryModel');
const { env } = require('../config/env');
const { logTx } = require('./transactionService');
const { safeTelegram } = require('../utils/telegram');
const { fmt, escHtml } = require('../utils/format');
const logger = require('../utils/logger');

const TZ = 'Asia/Yangon';
const MIN_AUCTION_BID = 1;
const AUCTION_TTL_MS = 10 * 60 * 1000;
const AUCTION_HISTORY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const AUCTION_TELEGRAM_TIMEOUT_MS = 7000;

const auctions = () => col('auctions');
const auctionBids = () => col('auction_bids');

const CUSTOM_IDS = new Set();
const channelUpdateChains = new Map();

function emoji(kind, fallback) {
  const key = String(kind).toUpperCase();
  const id = process.env['AUCTION_EMOJI_' + key] || process.env['TWO_D_EMOJI_' + key];
  if (!id || !CUSTOM_IDS.has(String(id))) return fallback;
  return '<tg-emoji emoji-id="' + escHtml(String(id)) + '">' + fallback + '</tg-emoji>';
}

async function validateCustomEmojis(bot) {
  CUSTOM_IDS.clear();
  const ids = Array.from(new Set(Object.keys(process.env)
    .filter(k => /^(?:AUCTION|TWO_D)_EMOJI_[A-Z0-9_]+$/.test(k))
    .map(k => String(process.env[k] || '').trim())
    .filter(Boolean)));
  if (!ids.length) return;
  if (typeof bot.telegram.getCustomEmojiStickers !== 'function') {
    ids.forEach(id => CUSTOM_IDS.add(id));
    return;
  }
  try {
    const stickers = await bot.telegram.getCustomEmojiStickers(ids);
    const valid = new Set((stickers || [])
      .filter(x => x && x.type === 'custom_emoji' && x.custom_emoji_id)
      .map(x => String(x.custom_emoji_id)));
    ids.forEach(id => { if (valid.has(id)) CUSTOM_IDS.add(id); });
  } catch (err) {
    ids.forEach(id => CUSTOM_IDS.add(id));
    logger.warn('Auction custom emoji validation failed: ' + (err?.message || err));
  }
}

function owner(ctx) {
  return Number(ctx.from?.id) === Number(env.OWNER_ID);
}

function money(value) {
  return String.fromCharCode(36) + fmt(Math.max(0, Math.floor(Number(value) || 0)));
}

function parseAmount(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isSafeInteger(n) && n >= MIN_AUCTION_BID ? n : null;
}

function parseMinutes(value) {
  const n = Number(String(value || '').trim());
  return Number.isSafeInteger(n) && n >= 1 && n <= 10080 ? n : null;
}

function remaining(endAt) {
  const ms = Math.max(0, new Date(endAt).getTime() - Date.now());
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return d ? d + 'd ' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') : String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function mention(user) {
  const id = Number(user.userId || user.id);
  const name = escHtml(user.firstName || user.first_name || user.username || 'Player');
  return '<a href="tg://user?id=' + id + '">' + name + '</a>';
}

function withTimeout(task, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label || 'TELEGRAM_TIMEOUT')), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

function countdownIntervalSeconds(remainingSeconds) {
  if (remainingSeconds <= 10) return 1;
  if (remainingSeconds < 120) return 20;
  if (remainingSeconds < 3600) return 30;
  return 40;
}

function countdownBar(endAt) {
  const remainingSeconds = Math.max(0, Math.floor((new Date(endAt).getTime() - Date.now()) / 1000));
  if (remainingSeconds > 10) return '';
  const filled = Math.min(10, Math.max(0, 10 - remainingSeconds));
  return '\n' + emoji('TIME', '⏳') + ' <code>' + '▰'.repeat(filled) + '▱'.repeat(10 - filled) + '</code> <b>' + remainingSeconds + 's</b>\n';
}

function parseBidText(text) {
  const raw = String(text || '').trim().replace(/^(?:bid|💰)\s*/i, '');
  if (!/^[\d,]+$/.test(raw)) return null;
  return parseAmount(raw);
}

function postText(a, finalState) {
  const status = finalState ? emoji('ENDED', '🏁') + ' <b>AUCTION ENDED</b>' : emoji('LIVE', '🔥') + ' <b>LIVE AUCTION</b>';
  const hasBids = Number(a.totalBids || 0) > 0;
  const current = hasBids ? Number(a.currentBid || 0) : Number(a.startingBid || 0);
  const next = hasBids ? current + Number(a.minIncrement || 1) : Number(a.startingBid || 0);
  const bidder = a.highestBidderId ? mention({
    userId: a.highestBidderId,
    firstName: a.highestBidderName,
    username: a.highestBidderUsername
  }) : '<i>— No bids yet —</i>';
  const winner = finalState && a.highestBidderId ? '\n\n' + emoji('WINNER', '🏆') + ' <b>WINNER</b>\n' + bidder + '\n' + emoji('PRICE', '💰') + ' <b>' + money(current) + '</b>' : '';
  return status + '\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    emoji('ITEM', '💎') + ' <b>' + escHtml(a.title || 'Auction Item') + '</b>\n\n' +
    emoji('CURRENT', '💰') + ' <b>CURRENT BID</b>\n      <b>' + money(current) + '</b>\n\n' +
    emoji('BIDDER', '👑') + ' <b>HIGHEST BIDDER</b>\n      ' + bidder + '\n\n' +
    (finalState ? '' : emoji('NEXT', '📈') + ' <b>NEXT MINIMUM</b>\n      <b>' + money(next) + '</b>\n\n') +
    emoji('BIDS', '👥') + ' <b>TOTAL BIDS</b>  ' + Number(a.totalBids || 0) + '\n' +
    (finalState ? '' : emoji('TIME', '⏳') + ' <b>TIME LEFT</b>  ' + remaining(a.endAt) + countdownBar(a.endAt) + '\n') +
    '\n━━━━━━━━━━━━━━━━━━\n' +
    (finalState
      ? emoji('LOCK', '🔒') + ' <b>Comment Bids ပိတ်သွားပါပြီ</b>'
      : emoji('COMMENT', '💬') + ' <b>Comment မှာ Bid တင်ပါ</b>\n' +
        '<code>' + String(Math.floor(Number(next) || 0)) + '</code> လို့ တိုက်ရိုက်ပို့နိုင်ပါတယ်') +
    winner;
}

function historyText(rows, a) {
  const title = escHtml(a?.title || 'Auction');
  const header = emoji('HISTORY', '📊') + ' <b>BID HISTORY</b>\n━━━━━━━━━━━━━━━━━━\n' +
    emoji('ITEM', '💎') + ' <b>' + title + '</b>\n' +
    emoji('BIDS', '👥') + ' Total: <b>' + rows.length + '</b>\n';
  if (!rows.length) return header + '\n<i>Bid မရှိခဲ့ပါ။</i>';
  const lines = rows.slice(-50).reverse().map((x, i) =>
    (i + 1) + '. ' + mention(x) + ' — <b>' + money(x.amount) + '</b>'
  );
  return header + '\n' + lines.join('\n');
}

async function updateChannelPost(bot, a, finalState) {
  if (!a?.channelMessageId || !env.AUCTION_CHANNEL_ID) return false;

  const key = String(a.auctionId);
  const previous = channelUpdateChains.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(async () => {
    try {
      if (!finalState) {
        const latest = await auctions().findOne({ auctionId: key }, { projection: { status: 1 } });
        if (!latest || latest.status !== 'open') return false;
      }

      if (a.mediaType === 'photo' || a.mediaType === 'video') {
        await withTimeout(() => safeTelegram(() => bot.telegram.editMessageCaption(
          env.AUCTION_CHANNEL_ID,
          Number(a.channelMessageId),
          undefined,
          postText(a, finalState),
          { parse_mode: 'HTML' }
        )), AUCTION_TELEGRAM_TIMEOUT_MS, 'AUCTION_EDIT_TIMEOUT');
      } else {
        await withTimeout(() => safeTelegram(() => bot.telegram.editMessageText(
          env.AUCTION_CHANNEL_ID,
          Number(a.channelMessageId),
          undefined,
          postText(a, finalState),
          { parse_mode: 'HTML', disable_web_page_preview: true }
        )), AUCTION_TELEGRAM_TIMEOUT_MS, 'AUCTION_EDIT_TIMEOUT');
      }
      return true;
    } catch (err) {
      logger.warn('Auction post update failed: ' + (err?.message || err));
      return false;
    }
  });
  channelUpdateChains.set(key, current);
  try {
    return await current;
  } finally {
    if (channelUpdateChains.get(key) === current) channelUpdateChains.delete(key);
  }
}

async function sendAuctionMessage(bot, a) {
  const opts = { parse_mode: 'HTML', disable_web_page_preview: true };
  if (a.mediaType === 'photo' && a.fileId) {
    return bot.telegram.sendPhoto(env.AUCTION_CHANNEL_ID, a.fileId, { caption: postText(a, false), ...opts });
  }
  if (a.mediaType === 'video' && a.fileId) {
    return bot.telegram.sendVideo(env.AUCTION_CHANNEL_ID, a.fileId, { caption: postText(a, false), ...opts });
  }
  return bot.telegram.sendMessage(env.AUCTION_CHANNEL_ID, postText(a, false), opts);
}

async function createAuction(bot, ctx) {
  if (!owner(ctx)) return ctx.reply('⛔ Owner only.');
  if (!env.AUCTION_CHANNEL_ID) return ctx.reply('⚠️ AUCTION_CHANNEL_ID ကို env မှာ သတ်မှတ်ပေးပါ။');

  const raw = String(ctx.message?.text || '').replace(/^\/auction(?:@\w+)?\s*/i, '').trim();
  const parts = raw.split(/\s+/);
  if (parts.length < 3) {
    return ctx.reply('အသုံးပြုပုံ:\n<code>/auction 10000 1000 30 Mikasa Ackerman</code>\n\n10000 = Starting Bid\n1000 = Minimum Increment\n30 = Minutes', { parse_mode: 'HTML' });
  }

  const startingBid = parseAmount(parts.shift());
  const minIncrement = parseAmount(parts.shift());
  const minutes = parseMinutes(parts.shift());
  const title = parts.join(' ').trim() || 'Auction Item';
  if (!startingBid || !minIncrement || !minutes) {
    return ctx.reply('⚠️ Starting / Increment / Duration ပုံစံမှားနေပါတယ်။');
  }

  const reply = ctx.message?.reply_to_message;
  let mediaType = null;
  let fileId = null;
  if (reply?.photo?.length) {
    mediaType = 'photo';
    fileId = reply.photo[reply.photo.length - 1].file_id;
  } else if (reply?.video?.file_id) {
    mediaType = 'video';
    fileId = reply.video.file_id;
  }

  const now = new Date();
  const a = {
    auctionId: 'auc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    channelId: String(env.AUCTION_CHANNEL_ID),
    discussionChatId: null,
    discussionRootMessageId: null,
    channelMessageId: null,
    title,
    mediaType,
    fileId,
    startingBid,
    minIncrement,
    currentBid: startingBid - minIncrement,
    highestBidderId: null,
    highestBidderName: null,
    highestBidderUsername: null,
    totalBids: 0,
    status: 'open',
    startAt: now,
    endAt: new Date(now.getTime() + minutes * 60000),
    createdBy: Number(ctx.from.id),
    createdAt: now,
    updatedAt: now
  };

  await auctions().insertOne(a);
  try {
    const sent = await sendAuctionMessage(bot, a);
    a.channelMessageId = Number(sent.message_id);
    a.discussionChatId = await getDiscussionChatId(bot);
    await auctions().updateOne(
      { auctionId: a.auctionId },
      { $set: { channelMessageId: a.channelMessageId, discussionChatId: a.discussionChatId, updatedAt: new Date() } }
    );
  } catch (err) {
    await auctions().deleteOne({ auctionId: a.auctionId });
    throw err;
  }
  return ctx.reply(
    emoji('SUCCESS', '✅') + ' <b>Auction စတင်ပြီးပါပြီ</b>\n\n' +
    emoji('ITEM', '💎') + ' ' + escHtml(title) + '\n' +
    emoji('PRICE', '💰') + ' Start: <b>' + money(startingBid) + '</b>\n' +
    emoji('TIME', '⏳') + ' Duration: <b>' + minutes + ' minutes</b>',
    { parse_mode: 'HTML' }
  );
}

async function getDiscussionChatId... (truncated)