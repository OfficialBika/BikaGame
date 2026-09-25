'use strict';

const { col, withMaybeTx } = require('../config/database');
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

const auctions = () => col('auctions');
const auctionBids = () => col('auction_bids');

const CUSTOM_IDS = new Set();

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
  return '
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
  const winner = finalState && a.highestBidderId ? '\n\n' + emoji('WINNER', '🏆') + ' <b>WINNER</b>\n' + bidder + '\n' + emoji('PRICE', '💰') + ' <b>' + money(current) + ' MMK</b>' : '';
  return status + '\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    emoji('ITEM', '💎') + ' <b>' + escHtml(a.title || 'Auction Item') + '</b>\n\n' +
    emoji('CURRENT', '💰') + ' <b>CURRENT BID</b>\n      <b>' + money(current) + ' MMK</b>\n\n' +
    emoji('BIDDER', '👑') + ' <b>HIGHEST BIDDER</b>\n      ' + bidder + '\n\n' +
    (finalState ? '' : emoji('NEXT', '📈') + ' <b>NEXT MINIMUM</b>\n      <b>' + money(next) + ' MMK</b>\n\n') +
    emoji('BIDS', '👥') + ' <b>TOTAL BIDS</b>  ' + Number(a.totalBids || 0) + '\n' +
    (finalState ? '' : emoji('TIME', '⏳') + ' <b>TIME LEFT</b>  ' + remaining(a.endAt) + '\n') +
    '\n━━━━━━━━━━━━━━━━━━\n' +
    (finalState
      ? emoji('LOCK', '🔒') + ' <b>Comment Bids ပိတ်သွားပါပြီ</b>'
      : emoji('COMMENT', '💬') + ' <b>Comment မှာ Bid တင်ပါ</b>\n' +
        '<code>' + money(next) + '</code> လို့ တိုက်ရိုက်ပို့နိုင်ပါတယ်') +
    winner;
}


function historyText(rows) {
  if (!rows.length) return emoji('HISTORY', '📊') + ' <b>BID HISTORY</b>\n━━━━━━━━━━━━━━━━━━\n<i>Bid မရှိသေးပါ။</i>';
  const lines = rows.slice(-10).reverse().map((x, i) =>
    (i + 1) + '. ' + mention(x) + ' — <b>' + money(x.amount) + ' MMK</b>'
  );
  return emoji('HISTORY', '📊') + ' <b>BID HISTORY</b>\n━━━━━━━━━━━━━━━━━━\n' + lines.join('\n');
}

async function updateChannelPost(bot, a, finalState) {
  if (!a.channelMessageId || !env.AUCTION_CHANNEL_ID) return;
  try {
    if (a.mediaType === 'photo' || a.mediaType === 'video') {
      await safeTelegram(() => bot.telegram.editMessageCaption(
        env.AUCTION_CHANNEL_ID,
        Number(a.channelMessageId),
        undefined,
        postText(a, finalState),
        { parse_mode: 'HTML' }
      ));
    } else {
      await safeTelegram(() => bot.telegram.editMessageText(
        env.AUCTION_CHANNEL_ID,
        Number(a.channelMessageId),
        undefined,
        postText(a, finalState),
        { parse_mode: 'HTML', disable_web_page_preview: true }
      ));
    }
  } catch (err) {
    logger.warn('Auction post update failed: ' + (err?.message || err));
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
    emoji('PRICE', '💰') + ' Start: <b>' + money(startingBid) + ' MMK</b>\n' +
    emoji('TIME', '⏳') + ' Duration: <b>' + minutes + ' minutes</b>',
    { parse_mode: 'HTML' }
  );
}

async function getDiscussionChatId(bot) {
  try {
    const c = await safeTelegram(() => bot.telegram.getChat(env.AUCTION_CHANNEL_ID));
    return c?.linked_chat_id ? String(c.linked_chat_id) : (env.AUCTION_DISCUSSION_CHAT_ID ? String(env.AUCTION_DISCUSSION_CHAT_ID) : null);
  } catch (_) {
    return env.AUCTION_DISCUSSION_CHAT_ID ? String(env.AUCTION_DISCUSSION_CHAT_ID) : null;
  }
}

async function captureDiscussionRoot(message) {
  if (!message?.chat?.id || !message.is_automatic_forward) return false;
  const origin = message.forward_origin;
  const originChatId = origin?.type === 'channel' ? origin.chat?.id : message.sender_chat?.id;
  const originMessageId = origin?.type === 'channel' ? origin.message_id : 0;
  if (!originChatId || String(originChatId) !== String(env.AUCTION_CHANNEL_ID) || !originMessageId) return false;
  const a = await auctions().findOne({ channelMessageId: Number(originMessageId), status: 'open' });
  if (!a) return false;
  await auctions().updateOne({ auctionId: a.auctionId }, {
    $set: { discussionChatId: String(message.chat.id), discussionRootMessageId: Number(message.message_id), updatedAt: new Date() }
  });
  return true;
}

async function isAuctionComment(message, a) {
  if (!message || !a || a.status !== 'open') return false;
  if (String(message.chat?.id) !== String(a.discussionChatId || '')) return false;
  if (message.from?.is_bot) return false;
  const root = Number(a.discussionRootMessageId || 0);
  const reply = message.reply_to_message;
  if (!root || !reply) return false;
  if (Number(reply.message_id) === root) return true;

  const parent = await auctionBids().findOne({
    auctionId: a.auctionId,
    $or: [
      { messageId: Number(reply.message_id) },
      { replyMessageId: Number(reply.message_id) }
    ]
  });
  return !!parent;
}

async function bid(ctx, bot, a) {
  const amount = parseBidText(ctx.message?.text);
  if (!amount) return;
  const current = Number(a.currentBid || (a.startingBid - a.minIncrement));
  const minimum = current + Number(a.minIncrement || 1);
  if (amount < minimum) {
    return ctx.reply(emoji('WARNING', '⚠️') + ' <b>Bid မအောင်မြင်ပါ</b>\n\n' +
      emoji('CURRENT', '💰') + ' Current: <b>' + money(current) + '</b>\n' +
      emoji('NEXT', '📈') + ' အနည်းဆုံး: <b>' + money(minimum) + '</b>',
      { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
  }

  const userId = ctx.from.id;
  const now = new Date();
  let result = null;

  await withMaybeTx(async (session) => {
    const opt = session ? { session } : {};
    const fresh = await auctions().findOne({ auctionId: a.auctionId, status: 'open', endAt: { $gt: now } }, opt);
    if (!fresh) throw new Error('AUCTION_CLOSED');
    const oldBid = Number(fresh.currentBid || (fresh.startingBid - fresh.minIncrement));
    const min = oldBid + Number(fresh.minIncrement || 1);
    if (amount < min) throw new Error('BID_TOO_LOW');

    const oldUserId = fresh.highestBidderId ? String(fresh.highestBidderId) : null;
    const newUserId = String(userId);
    const oldAmount = oldUserId ? Number(fresh.currentBid || 0) : 0;

    // Only the current highest bid is held. The new bid is charged first,
    // then the previous highest bidder is fully refunded.
    let charge = amount;
    if (oldUserId && oldUserId === newUserId) charge = Math.max(0, amount - oldAmount);

    const user = await userModel.collection().findOneAndUpdate(
      { userId: { $in: [userId, String(userId)] }, balance: { $gte: charge } },
      { $inc: { balance: -charge }, $set: { updatedAt: now } },
      Object.assign({ returnDocument: 'after' }, opt)
    );
    const chargedUser = user?.value !== undefined ? user.value : user;
    if (!chargedUser) throw new Error('INSUFFICIENT');

    if (oldUserId && oldUserId !== newUserId && oldAmount > 0) {
      await userModel.collection().updateOne(
        { userId: { $in: [fresh.highestBidderId, String(fresh.highestBidderId)] } },
        { $inc: { balance: oldAmount }, $set: { updatedAt: now } },
        opt
      );
      await logTx({ type: 'auction_refund', fromUserId: 'TREASURY_HOLD', toUserId: fresh.highestBidderId, amount: oldAmount, meta: { auctionId: fresh.auctionId } }, opt);
    }

    if (charge > 0) {
      await logTx({ type: 'auction_hold', fromUserId: chargedUser.userId, toUserId: 'TREASURY_HOLD', amount: charge, meta: { auctionId: fresh.auctionId, bid: amount } }, opt);
    }

    const bidDoc = {
      auctionId: fresh.auctionId,
      userId: chargedUser.userId,
      firstName: ctx.from.first_name || null,
      username: ctx.from.username || null,
      amount,
      messageId: Number(ctx.message.message_id),
      createdAt: now
    };
    await auctionBids().insertOne(bidDoc, opt);

    const update = await auctions().findOneAndUpdate(
      { auctionId: fresh.auctionId, status: 'open', currentBid: oldBid, highestBidderId: fresh.highestBidderId || null },
      { $set: {
        currentBid: amount,
        highestBidderId: chargedUser.userId,
        highestBidderName: ctx.from.first_name || ctx.from.username || 'Player',
        highestBidderUsername: ctx.from.username || null,
        totalBids: Number(fresh.totalBids || 0) + 1,
        updatedAt: now
      }},
      Object.assign({ returnDocument: 'after' }, opt)
    );
    const updated = update?.value !== undefined ? update.value : update;
    if (!updated) throw new Error('BID_RACE');
    result = { auction: updated, oldAmount, oldUserId, charge };
  });

  await updateChannelPost(bot, result.auction, false);
  const balance = await userModel.collection().findOne({ userId: { $in: [userId, String(userId)] } });
  return ctx.reply(
    emoji('ACCEPTED', '🔥') + ' <b>BID ACCEPTED</b>\n━━━━━━━━━━━━━━━━━━\n' +
    emoji('BIDDER', '👤') + ' ' + mention({ userId, firstName: ctx.from.first_name, username: ctx.from.username }) + '\n' +
    emoji('PRICE', '💰') + ' <b>' + money(amount) + ' MMK</b>\n' +
    emoji('CROWN', '👑') + ' <b>NEW HIGHEST BIDDER</b>\n' +
    emoji('NEXT', '📈') + ' Next: <b>' + money(amount + Number(result.auction.minIncrement)) + ' MMK</b>\n' +
    emoji('BALANCE', '💳') + ' Balance: <b>' + money(balance?.balance) + ' MMK</b>',
    { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
  );
}

async function showHistory(ctx) {
  const raw = String(ctx.callbackQuery?.data || '');
  const id = raw.replace(/^auction:history:/, '');
  const a = await auctions().findOne({ auctionId: id });
  if (!a) return ctx.answerCbQuery('Auction မရှိတော့ပါ။');
  const rows = await auctionBids().find({ auctionId: id }).sort({ createdAt: 1 }).limit(50).toArray();
  await ctx.answerCbQuery();
  return ctx.telegram.sendMessage(
    ctx.from.id,
    historyText(rows),
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
}

function register(bot) {
  bot.command('auction', ctx => createAuction(bot, ctx));

  bot.action(/^auction:history:/, ctx => showHistory(ctx));

  bot.on('message', async (ctx, next) => {
    try {
      if (await captureDiscussionRoot(ctx.message)) return;
      const a = await auctions().findOne({ channelId: String(env.AUCTION_CHANNEL_ID), status: 'open', endAt: { $gt: new Date() } }, { sort: { createdAt: -1 } });
      if (a && await isAuctionComment(ctx.message, a)) {
        try { await bid(ctx, bot, a); }
        catch (err) {
          const code = String(err.message || err);
          const msg = code === 'INSUFFICIENT'
            ? emoji('WARNING', '⚠️') + ' <b>Balance မလုံလောက်ပါ</b>'
            : code === 'AUCTION_CLOSED'
              ? emoji('LOCK', '🔒') + ' Auction ပိတ်သွားပါပြီ။'
              : code === 'BID_TOO_LOW'
                ? emoji('WARNING', '⚠️') + ' <b>အမြင့်ဆုံး Bid ကို ကျော်ရပါမယ်။</b>'
                : emoji('WARNING', '⚠️') + ' Bid မအောင်မြင်ပါ။ ခဏနေ ပြန်စမ်းပါ။';
          await ctx.reply(msg, { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
        }
        return;
      }
      return next();
    } catch (err) {
      logger.error('Auction message handler failed', err);
      return next();
    }
  });
}

async function closeAuction(bot, a) {
  const claim0 = await auctions().findOneAndUpdate(
    { auctionId: a.auctionId, status: 'open', endAt: { $lte: new Date() } },
    { $set: { status: 'closing', closedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  const claim = claim0?.value !== undefined ? claim0.value : claim0;
  if (!claim) return null;

  const now = new Date();
  let closed = claim;
  await withMaybeTx(async (session) => {
    const opt = session ? { session } : {};
    const winnerId = claim.highestBidderId ? String(claim.highestBidderId) : null;
    const finalAmount = Number(claim.currentBid || 0);
    if (winnerId && finalAmount > 0) {
      await treasuryModel.collection().updateOne(
        { key: 'treasury' },
        { $inc: { ownerBalance: finalAmount }, $set: { updatedAt: now } },
        opt
      );
      await logTx({ type: 'auction_win_settlement', fromUserId: winnerId, toUserId: 'TREASURY', amount: finalAmount, meta: { auctionId: claim.auctionId } }, opt);
    }
    await auctions().updateOne(
      { auctionId: claim.auctionId, status: 'closing' },
      { $set: { status: 'closed', winnerId, finalAmount, settledAt: now, updatedAt: now } },
      opt
    );
  });

  closed = await auctions().findOne({ auctionId: claim.auctionId });
  await updateChannelPost(bot, closed, true);

  const winnerText = closed.winnerId
    ? emoji('WINNER', '🏆') + ' <b>AUCTION WINNER</b>\n\n' +
      mention({ userId: closed.winnerId, firstName: closed.highestBidderName, username: closed.highestBidderUsername }) +
      '\n\n' + emoji('PRICE', '💰') + ' Final Bid: <b>' + money(closed.finalAmount) + ' MMK</b>'
    : emoji('ENDED', '🏁') + ' <b>Auction ပြီးပါပြီ</b>\n\nBid မရှိခဲ့ပါ။';

  if (closed.discussionChatId && closed.discussionRootMessageId) {
    try {
      await bot.telegram.sendMessage(String(closed.discussionChatId), winnerText, {
        parse_mode: 'HTML',
        reply_to_message_id: Number(closed.discussionRootMessageId)
      });
    } catch (err) {
      logger.warn('Auction winner comment failed: ' + (err?.message || err));
    }
  }

  // Keep only the public channel result. Remove all temporary auction state immediately after settlement.
  await auctionBids().deleteMany({ auctionId: closed.auctionId });
  await auctions().deleteOne({ auctionId: closed.auctionId });
  return closed;
}

async function init(bot) {
  await validateCustomEmojis(bot);
  await ensureTreasury();
  if (!env.AUCTION_CHANNEL_ID) {
    logger.warn('Auction disabled: AUCTION_CHANNEL_ID is not configured');
    return () => {};
  }

  await auctions().createIndex({ auctionId: 1 }, { unique: true, name: 'auctions_id_unique' });
  await auctions().createIndex({ channelId: 1, status: 1, endAt: 1 }, { name: 'auctions_active_end' });
  await auctions().createIndex({ channelMessageId: 1 }, { unique: true, sparse: true, name: 'auctions_channel_message_unique' });
  await auctionBids().createIndex({ auctionId: 1, createdAt: 1 }, { name: 'auction_bids_time' });
  await auctionBids().createIndex({ auctionId: 1, messageId: 1 }, { unique: true, name: 'auction_bids_message_unique' });

  let busy = false;
  const lastCountdownBucket = new Map();

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Date();
      const expired = await auctions().find({ status: 'open', endAt: { $lte: now } }).limit(10).toArray();
      for (const a of expired) {
        try {
          lastCountdownBucket.delete(a.auctionId);
          await closeAuction(bot, a);
        } catch (err) {
          logger.error('Auction close failed', err);
        }
      }

      // Keep the public channel countdown lightweight:
      // - More than 10 seconds left: edit once per 10-second bucket.
      // - 10 seconds or less: edit once per 2-second bucket.
      // The actual auction deadline always comes from endAt; these edits only
      // refresh the displayed countdown and never extend/shorten the auction.
      const active = await auctions()
        .find({ status: 'open', endAt: { $gt: now } })
        .limit(20)
        .toArray();

      for (const a of active) {
        const remainingSeconds = Math.max(0, Math.floor((new Date(a.endAt).getTime() - now.getTime()) / 1000));
        const bucket = remainingSeconds <= 10
          ? Math.floor(remainingSeconds / 2) * 2
          : Math.floor(remainingSeconds / 10) * 10;

        if (lastCountdownBucket.get(a.auctionId) === bucket) continue;
        lastCountdownBucket.set(a.auctionId, bucket);

        try {
          await updateChannelPost(bot, a, false);
        } catch (err) {
          logger.warn('Auction countdown update failed: ' + (err?.message || err));
        }
      }

      const activeIds = new Set(active.map(x => x.auctionId));
      for (const id of lastCountdownBucket.keys()) {
        if (!activeIds.has(id)) lastCountdownBucket.delete(id);
      }
    } finally {
      busy = false;
    }
  };

  await tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

module.exports = { register, init };
 + fmt(Math.max(0, Math.floor(Number(value) || 0)));
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
  const winner = finalState && a.highestBidderId ? '\n\n' + emoji('WINNER', '🏆') + ' <b>WINNER</b>\n' + bidder + '\n' + emoji('PRICE', '💰') + ' <b>' + money(current) + ' MMK</b>' : '';
  return status + '\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    emoji('ITEM', '💎') + ' <b>' + escHtml(a.title || 'Auction Item') + '</b>\n\n' +
    emoji('CURRENT', '💰') + ' <b>CURRENT BID</b>\n      <b>' + money(current) + ' MMK</b>\n\n' +
    emoji('BIDDER', '👑') + ' <b>HIGHEST BIDDER</b>\n      ' + bidder + '\n\n' +
    (finalState ? '' : emoji('NEXT', '📈') + ' <b>NEXT MINIMUM</b>\n      <b>' + money(next) + ' MMK</b>\n\n') +
    emoji('BIDS', '👥') + ' <b>TOTAL BIDS</b>  ' + Number(a.totalBids || 0) + '\n' +
    (finalState ? '' : emoji('TIME', '⏳') + ' <b>TIME LEFT</b>  ' + remaining(a.endAt) + '\n') +
    '\n━━━━━━━━━━━━━━━━━━\n' +
    (finalState
      ? emoji('LOCK', '🔒') + ' <b>Comment Bids ပိတ်သွားပါပြီ</b>'
      : emoji('COMMENT', '💬') + ' <b>Comment မှာ Bid တင်ပါ</b>\n' +
        '<code>' + money(next) + '</code> လို့ တိုက်ရိုက်ပို့နိုင်ပါတယ်') +
    winner;
}


function historyText(rows) {
  if (!rows.length) return emoji('HISTORY', '📊') + ' <b>BID HISTORY</b>\n━━━━━━━━━━━━━━━━━━\n<i>Bid မရှိသေးပါ။</i>';
  const lines = rows.slice(-10).reverse().map((x, i) =>
    (i + 1) + '. ' + mention(x) + ' — <b>' + money(x.amount) + ' MMK</b>'
  );
  return emoji('HISTORY', '📊') + ' <b>BID HISTORY</b>\n━━━━━━━━━━━━━━━━━━\n' + lines.join('\n');
}

async function updateChannelPost(bot, a, finalState) {
  if (!a.channelMessageId || !env.AUCTION_CHANNEL_ID) return;
  try {
    if (a.mediaType === 'photo' || a.mediaType === 'video') {
      await safeTelegram(() => bot.telegram.editMessageCaption(
        env.AUCTION_CHANNEL_ID,
        Number(a.channelMessageId),
        undefined,
        postText(a, finalState),
        { parse_mode: 'HTML' }
      ));
    } else {
      await safeTelegram(() => bot.telegram.editMessageText(
        env.AUCTION_CHANNEL_ID,
        Number(a.channelMessageId),
        undefined,
        postText(a, finalState),
        { parse_mode: 'HTML', disable_web_page_preview: true }
      ));
    }
  } catch (err) {
    logger.warn('Auction post update failed: ' + (err?.message || err));
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
    emoji('PRICE', '💰') + ' Start: <b>' + money(startingBid) + ' MMK</b>\n' +
    emoji('TIME', '⏳') + ' Duration: <b>' + minutes + ' minutes</b>',
    { parse_mode: 'HTML' }
  );
}

async function getDiscussionChatId(bot) {
  try {
    const c = await safeTelegram(() => bot.telegram.getChat(env.AUCTION_CHANNEL_ID));
    return c?.linked_chat_id ? String(c.linked_chat_id) : (env.AUCTION_DISCUSSION_CHAT_ID ? String(env.AUCTION_DISCUSSION_CHAT_ID) : null);
  } catch (_) {
    return env.AUCTION_DISCUSSION_CHAT_ID ? String(env.AUCTION_DISCUSSION_CHAT_ID) : null;
  }
}

async function captureDiscussionRoot(message) {
  if (!message?.chat?.id || !message.is_automatic_forward) return false;
  const origin = message.forward_origin;
  const originChatId = origin?.type === 'channel' ? origin.chat?.id : message.sender_chat?.id;
  const originMessageId = origin?.type === 'channel' ? origin.message_id : 0;
  if (!originChatId || String(originChatId) !== String(env.AUCTION_CHANNEL_ID) || !originMessageId) return false;
  const a = await auctions().findOne({ channelMessageId: Number(originMessageId), status: 'open' });
  if (!a) return false;
  await auctions().updateOne({ auctionId: a.auctionId }, {
    $set: { discussionChatId: String(message.chat.id), discussionRootMessageId: Number(message.message_id), updatedAt: new Date() }
  });
  return true;
}

async function isAuctionComment(message, a) {
  if (!message || !a || a.status !== 'open') return false;
  if (String(message.chat?.id) !== String(a.discussionChatId || '')) return false;
  if (message.from?.is_bot) return false;
  const root = Number(a.discussionRootMessageId || 0);
  const reply = message.reply_to_message;
  if (!root || !reply) return false;
  if (Number(reply.message_id) === root) return true;

  const parent = await auctionBids().findOne({
    auctionId: a.auctionId,
    $or: [
      { messageId: Number(reply.message_id) },
      { replyMessageId: Number(reply.message_id) }
    ]
  });
  return !!parent;
}

async function bid(ctx, bot, a) {
  const amount = parseBidText(ctx.message?.text);
  if (!amount) return;
  const current = Number(a.currentBid || (a.startingBid - a.minIncrement));
  const minimum = current + Number(a.minIncrement || 1);
  if (amount < minimum) {
    return ctx.reply(emoji('WARNING', '⚠️') + ' <b>Bid မအောင်မြင်ပါ</b>\n\n' +
      emoji('CURRENT', '💰') + ' Current: <b>' + money(current) + '</b>\n' +
      emoji('NEXT', '📈') + ' အနည်းဆုံး: <b>' + money(minimum) + '</b>',
      { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
  }

  const userId = ctx.from.id;
  const now = new Date();
  let result = null;

  await withMaybeTx(async (session) => {
    const opt = session ? { session } : {};
    const fresh = await auctions().findOne({ auctionId: a.auctionId, status: 'open', endAt: { $gt: now } }, opt);
    if (!fresh) throw new Error('AUCTION_CLOSED');
    const oldBid = Number(fresh.currentBid || (fresh.startingBid - fresh.minIncrement));
    const min = oldBid + Number(fresh.minIncrement || 1);
    if (amount < min) throw new Error('BID_TOO_LOW');

    const oldUserId = fresh.highestBidderId ? String(fresh.highestBidderId) : null;
    const newUserId = String(userId);
    const oldAmount = oldUserId ? Number(fresh.currentBid || 0) : 0;

    // Only the current highest bid is held. The new bid is charged first,
    // then the previous highest bidder is fully refunded.
    let charge = amount;
    if (oldUserId && oldUserId === newUserId) charge = Math.max(0, amount - oldAmount);

    const user = await userModel.collection().findOneAndUpdate(
      { userId: { $in: [userId, String(userId)] }, balance: { $gte: charge } },
      { $inc: { balance: -charge }, $set: { updatedAt: now } },
      Object.assign({ returnDocument: 'after' }, opt)
    );
    const chargedUser = user?.value !== undefined ? user.value : user;
    if (!chargedUser) throw new Error('INSUFFICIENT');

    if (oldUserId && oldUserId !== newUserId && oldAmount > 0) {
      await userModel.collection().updateOne(
        { userId: { $in: [fresh.highestBidderId, String(fresh.highestBidderId)] } },
        { $inc: { balance: oldAmount }, $set: { updatedAt: now } },
        opt
      );
      await logTx({ type: 'auction_refund', fromUserId: 'TREASURY_HOLD', toUserId: fresh.highestBidderId, amount: oldAmount, meta: { auctionId: fresh.auctionId } }, opt);
    }

    if (charge > 0) {
      await logTx({ type: 'auction_hold', fromUserId: chargedUser.userId, toUserId: 'TREASURY_HOLD', amount: charge, meta: { auctionId: fresh.auctionId, bid: amount } }, opt);
    }

    const bidDoc = {
      auctionId: fresh.auctionId,
      userId: chargedUser.userId,
      firstName: ctx.from.first_name || null,
      username: ctx.from.username || null,
      amount,
      messageId: Number(ctx.message.message_id),
      createdAt: now
    };
    await auctionBids().insertOne(bidDoc, opt);

    const update = await auctions().findOneAndUpdate(
      { auctionId: fresh.auctionId, status: 'open', currentBid: oldBid, highestBidderId: fresh.highestBidderId || null },
      { $set: {
        currentBid: amount,
        highestBidderId: chargedUser.userId,
        highestBidderName: ctx.from.first_name || ctx.from.username || 'Player',
        highestBidderUsername: ctx.from.username || null,
        totalBids: Number(fresh.totalBids || 0) + 1,
        updatedAt: now
      }},
      Object.assign({ returnDocument: 'after' }, opt)
    );
    const updated = update?.value !== undefined ? update.value : update;
    if (!updated) throw new Error('BID_RACE');
    result = { auction: updated, oldAmount, oldUserId, charge };
  });

  await updateChannelPost(bot, result.auction, false);
  const balance = await userModel.collection().findOne({ userId: { $in: [userId, String(userId)] } });
  return ctx.reply(
    emoji('ACCEPTED', '🔥') + ' <b>BID ACCEPTED</b>\n━━━━━━━━━━━━━━━━━━\n' +
    emoji('BIDDER', '👤') + ' ' + mention({ userId, firstName: ctx.from.first_name, username: ctx.from.username }) + '\n' +
    emoji('PRICE', '💰') + ' <b>' + money(amount) + ' MMK</b>\n' +
    emoji('CROWN', '👑') + ' <b>NEW HIGHEST BIDDER</b>\n' +
    emoji('NEXT', '📈') + ' Next: <b>' + money(amount + Number(result.auction.minIncrement)) + ' MMK</b>\n' +
    emoji('BALANCE', '💳') + ' Balance: <b>' + money(balance?.balance) + ' MMK</b>',
    { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }
  );
}

async function showHistory(ctx) {
  const raw = String(ctx.callbackQuery?.data || '');
  const id = raw.replace(/^auction:history:/, '');
  const a = await auctions().findOne({ auctionId: id });
  if (!a) return ctx.answerCbQuery('Auction မရှိတော့ပါ။');
  const rows = await auctionBids().find({ auctionId: id }).sort({ createdAt: 1 }).limit(50).toArray();
  await ctx.answerCbQuery();
  return ctx.telegram.sendMessage(
    ctx.from.id,
    historyText(rows),
    { parse_mode: 'HTML', disable_web_page_preview: true }
  );
}

function register(bot) {
  bot.command('auction', ctx => createAuction(bot, ctx));

  bot.action(/^auction:history:/, ctx => showHistory(ctx));

  bot.on('message', async (ctx, next) => {
    try {
      if (await captureDiscussionRoot(ctx.message)) return;
      const a = await auctions().findOne({ channelId: String(env.AUCTION_CHANNEL_ID), status: 'open', endAt: { $gt: new Date() } }, { sort: { createdAt: -1 } });
      if (a && await isAuctionComment(ctx.message, a)) {
        try { await bid(ctx, bot, a); }
        catch (err) {
          const code = String(err.message || err);
          const msg = code === 'INSUFFICIENT'
            ? emoji('WARNING', '⚠️') + ' <b>Balance မလုံလောက်ပါ</b>'
            : code === 'AUCTION_CLOSED'
              ? emoji('LOCK', '🔒') + ' Auction ပိတ်သွားပါပြီ။'
              : code === 'BID_TOO_LOW'
                ? emoji('WARNING', '⚠️') + ' <b>အမြင့်ဆုံး Bid ကို ကျော်ရပါမယ်။</b>'
                : emoji('WARNING', '⚠️') + ' Bid မအောင်မြင်ပါ။ ခဏနေ ပြန်စမ်းပါ။';
          await ctx.reply(msg, { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id });
        }
        return;
      }
      return next();
    } catch (err) {
      logger.error('Auction message handler failed', err);
      return next();
    }
  });
}

async function closeAuction(bot, a) {
  const claim0 = await auctions().findOneAndUpdate(
    { auctionId: a.auctionId, status: 'open', endAt: { $lte: new Date() } },
    { $set: { status: 'closing', closedAt: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  const claim = claim0?.value !== undefined ? claim0.value : claim0;
  if (!claim) return null;

  const now = new Date();
  let closed = claim;
  await withMaybeTx(async (session) => {
    const opt = session ? { session } : {};
    const winnerId = claim.highestBidderId ? String(claim.highestBidderId) : null;
    const finalAmount = Number(claim.currentBid || 0);
    if (winnerId && finalAmount > 0) {
      await treasuryModel.collection().updateOne(
        { key: 'treasury' },
        { $inc: { ownerBalance: finalAmount }, $set: { updatedAt: now } },
        opt
      );
      await logTx({ type: 'auction_win_settlement', fromUserId: winnerId, toUserId: 'TREASURY', amount: finalAmount, meta: { auctionId: claim.auctionId } }, opt);
    }
    await auctions().updateOne(
      { auctionId: claim.auctionId, status: 'closing' },
      { $set: { status: 'closed', winnerId, finalAmount, settledAt: now, updatedAt: now } },
      opt
    );
  });

  closed = await auctions().findOne({ auctionId: claim.auctionId });
  await updateChannelPost(bot, closed, true);

  const winnerText = closed.winnerId
    ? emoji('WINNER', '🏆') + ' <b>AUCTION WINNER</b>\n\n' +
      mention({ userId: closed.winnerId, firstName: closed.highestBidderName, username: closed.highestBidderUsername }) +
      '\n\n' + emoji('PRICE', '💰') + ' Final Bid: <b>' + money(closed.finalAmount) + ' MMK</b>'
    : emoji('ENDED', '🏁') + ' <b>Auction ပြီးပါပြီ</b>\n\nBid မရှိခဲ့ပါ။';

  if (closed.discussionChatId && closed.discussionRootMessageId) {
    try {
      await bot.telegram.sendMessage(String(closed.discussionChatId), winnerText, {
        parse_mode: 'HTML',
        reply_to_message_id: Number(closed.discussionRootMessageId)
      });
    } catch (err) {
      logger.warn('Auction winner comment failed: ' + (err?.message || err));
    }
  }

  // Keep only the public channel result. Remove all temporary auction state immediately after settlement.
  await auctionBids().deleteMany({ auctionId: closed.auctionId });
  await auctions().deleteOne({ auctionId: closed.auctionId });
  return closed;
}

async function init(bot) {
  await validateCustomEmojis(bot);
  await ensureTreasury();
  if (!env.AUCTION_CHANNEL_ID) {
    logger.warn('Auction disabled: AUCTION_CHANNEL_ID is not configured');
    return () => {};
  }

  await auctions().createIndex({ auctionId: 1 }, { unique: true, name: 'auctions_id_unique' });
  await auctions().createIndex({ channelId: 1, status: 1, endAt: 1 }, { name: 'auctions_active_end' });
  await auctions().createIndex({ channelMessageId: 1 }, { unique: true, sparse: true, name: 'auctions_channel_message_unique' });
  await auctionBids().createIndex({ auctionId: 1, createdAt: 1 }, { name: 'auction_bids_time' });
  await auctionBids().createIndex({ auctionId: 1, messageId: 1 }, { unique: true, name: 'auction_bids_message_unique' });

  let busy = false;
  const lastCountdownBucket = new Map();

  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const now = new Date();
      const expired = await auctions().find({ status: 'open', endAt: { $lte: now } }).limit(10).toArray();
      for (const a of expired) {
        try {
          lastCountdownBucket.delete(a.auctionId);
          await closeAuction(bot, a);
        } catch (err) {
          logger.error('Auction close failed', err);
        }
      }

      // Keep the public channel countdown lightweight:
      // - More than 10 seconds left: edit once per 10-second bucket.
      // - 10 seconds or less: edit once per 2-second bucket.
      // The actual auction deadline always comes from endAt; these edits only
      // refresh the displayed countdown and never extend/shorten the auction.
      const active = await auctions()
        .find({ status: 'open', endAt: { $gt: now } })
        .limit(20)
        .toArray();

      for (const a of active) {
        const remainingSeconds = Math.max(0, Math.floor((new Date(a.endAt).getTime() - now.getTime()) / 1000));
        const bucket = remainingSeconds <= 10
          ? Math.floor(remainingSeconds / 2) * 2
          : Math.floor(remainingSeconds / 10) * 10;

        if (lastCountdownBucket.get(a.auctionId) === bucket) continue;
        lastCountdownBucket.set(a.auctionId, bucket);

        try {
          await updateChannelPost(bot, a, false);
        } catch (err) {
          logger.warn('Auction countdown update failed: ' + (err?.message || err));
        }
      }

      const activeIds = new Set(active.map(x => x.auctionId));
      for (const id of lastCountdownBucket.keys()) {
        if (!activeIds.has(id)) lastCountdownBucket.delete(id);
      }
    } finally {
      busy = false;
    }
  };

  await tick();
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}

module.exports = { register, init };
