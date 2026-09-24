'use strict';

const { col, withMaybeTx } = require('../config/database');
const userModel = require('../models/userModel');
const { env } = require('../config/env');
const { logTx } = require('./transactionService');
const { safeTelegram } = require('../utils/telegram');
const { fmt, escHtml } = require('../utils/format');
const logger = require('../utils/logger');

const TZ = 'Asia/Yangon';
const PAYOUT = 40;
const MIN_BET = 200;
const MAX_PER_NUMBER = 200000;
const SCHEDULE = [
  { key: 'am', open: '08:00', close: '11:50' },
  { key: 'pm', open: '13:00', close: '16:29' },
];

const events = () => col('two_d_events');
const bets = () => col('two_d_bets');
const positions = () => col('two_d_positions');
const offdates = () => col('two_d_offdates');
// The bot's real treasury/bank document is stored in the config collection via treasuryService.
// Keep 2D settlement on the same ownerBalance used by /treasury and economyService.
const treasury = () => col('config');

const USER_SETTLEMENT_KEYS = 'twoDSettlementKeys';
function settlementKey(eventId, userId) { return String(eventId) + ':' + String(userId); }
function treasurySettlementKey(eventId) { return '2d:' + String(eventId); }

function yangonParts(date) {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date || new Date());
  const o = {};
  p.forEach(function (x) { if (x.type !== 'literal') o[x.type] = x.value; });
  return { year: +o.year, month: +o.month, day: +o.day, weekday: o.weekday, hour: +o.hour, minute: +o.minute };
}
function dateKey(date) {
  const p = yangonParts(date);
  return p.year + '-' + String(p.month).padStart(2, '0') + '-' + String(p.day).padStart(2, '0');
}
function dateKeyFromParts(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function yangonDateAt(key, hhmm) {
  const a = key.split('-').map(Number);
  const t = hhmm.split(':').map(Number);
  return new Date(Date.UTC(a[0], a[1] - 1, a[2], t[0], t[1]) - 23400000);
}
function displayDate(date) { const p = yangonParts(date); return p.day + '/' + p.month + '/' + p.year; }
function displayTime(date) {
  const p = yangonParts(date); let h = p.hour; const ap = h >= 12 ? 'PM' : 'AM'; h %= 12; if (!h) h = 12;
  return h + ':' + String(p.minute).padStart(2, '0') + ' ' + ap;
}
function dateTime(date) { return displayDate(date) + ' ' + displayTime(date); }
function emoji(kind, fallback) {
  const id = process.env['TWO_D_EMOJI_' + String(kind).toUpperCase()];
  return id ? '<tg-emoji emoji-id="' + escHtml(id) + '">' + fallback + '</tg-emoji>' : fallback;
}
function mention(user) {
  const name = escHtml(user.firstName || user.first_name || user.username || 'Player');
  return '<a href="tg://user?id=' + Number(user.userId || user.id) + '">' + name + '</a>';
}
function parseDateInput(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})[\\/.-](\d{1,2})[\\/.-](\d{4})$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3], dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dateKeyFromParts(y, mo, d);
}
function parseTimeInput(value) {
  const m = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return null; let h = +m[1], min = +(m[2] || 0);
  if (h < 1 || h > 12 || min > 59) return null;
  const ap = m[3].toUpperCase(); if (ap === 'AM' && h === 12) h = 0; if (ap === 'PM' && h !== 12) h += 12;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}
function parse2dCommand(text) {
  const m = String(text || '').trim().match(/^\.2d\s+(.+?)\s+(\d[\d,]*)$/i);
  if (!m) return { error: 'ပုံစံမှားနေပါတယ်။ ဥပမာ .2d 00.33.66 5000' };
  const amount = Number(m[2].replaceAll(',', ''));
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_PER_NUMBER) return { error: 'တစ်ကြိမ်ထိုးကြေးကို ' + fmt(MIN_BET) + ' မှ ' + fmt(MAX_PER_NUMBER) + ' အတွင်းထားပါ။' };
  const map = new Map();
  const display = [];
  const tokens = m[1].split(/[.\s,]+/).filter(Boolean);
  for (const raw of tokens) {
    const token = raw.toUpperCase(); let nums = [];
    if (/^\d{2}$/.test(token)) nums = [token];
    else if (/^\d{2}R$/.test(token)) { const n = token.slice(0, 2), r = n[1] + n[0]; nums = r === n ? [n] : [n, r]; }
    else return { error: '<code>' + escHtml(raw) + '</code> က 00-99 သို့မဟုတ် 00R ပုံစံမဟုတ်ပါ။' };
    display.push({ label: token, amount: amount, multiplier: nums.length });
    nums.forEach(function (n) { map.set(n, (map.get(n) || 0) + amount); });
  }
  const lines = Array.from(map, function (x) { return { number: x[0], amount: x[1] }; });
  if (!lines.length) return { error: 'ထိုးမည့်ဂဏန်းမတွေ့ပါ။' };
  return { lines: lines, display: display, total: lines.reduce(function (s, x) { return s + x.amount; }, 0) };
}
function owner(ctx) { return Number(ctx.from && ctx.from.id) === Number(env.OWNER_ID); }
function weekend(key) { const a = key.split('-').map(Number); const d = new Date(Date.UTC(a[0], a[1] - 1, a[2])).getUTCDay(); return d === 0 || d === 6; }
async function offDate(key) { return !!(await offdates().findOne({ dateKey: key })); }
async function getEvent(id) { return events().findOne({ eventId: id }); }
async function openEvent() { return events().findOne({ channelId: env.TWO_D_CHANNEL_ID, status: 'open', closeAt: { $gt: new Date() } }, { sort: { openAt: -1 } }); }
async function pendingResult() {
  return events().findOne({ channelId: env.TWO_D_CHANNEL_ID, status: { $in: ['closed', 'settling'] }, resultAt: null, closeAt: { $lte: new Date() } }, { sort: { closeAt: -1 } });
}
async function discussionId(bot) {
  if (env.TWO_D_DISCUSSION_CHAT_ID) return Number(env.TWO_D_DISCUSSION_CHAT_ID);
  if (!env.TWO_D_CHANNEL_ID) return null;
  const c = await safeTelegram(function () { return bot.telegram.getChat(env.TWO_D_CHANNEL_ID); });
  return c && c.linked_chat_id ? Number(c.linked_chat_id) : null;
}
function openText(e) {
  const test = e.manual ? '\n\n⚠️ <b>Owner စမ်းသပ်တဲ့ Post ပါ</b>\nကြေးအများကြီး မထိုးကြပါနဲ့။ အစစ်မဟုတ်ပါ။' : '';
  return emoji('BET', '🎯') + ' <b>BIKA 2D ထိုးကြေးဖွင့်ပါပြီရှင့်</b>\n' +
    '━━━━━━━━━━━━━━━━━━\n' +
    emoji('DATE', '📅') + ' <b>' + escHtml(dateTime(e.openAt)) + '</b>\n\n' +
    emoji('TIME', '⏳') + ' <b>' + escHtml(displayTime(e.closeAt)) + '</b> မှာ ထိုးကြေးပိတ်ပါမယ်\n\n' +
    emoji('MONEY', '💰') + ' ပေါက်ကြေး <b>' + PAYOUT + ' ဆ</b>\n' +
    emoji('TICKET', '🎟️') + ' ထိုးကြေးကန့်သတ်ချက် <b>' + fmt(MIN_BET) + ' → ' + fmt(MAX_PER_NUMBER) + '</b>\n\n' +
    emoji('USERS', '👥') + ' <b>Bika Game Bot ရဲ့ player အပေါင်းတို့က</b>\n\n' +
    'ယခု Post ရဲ့ Comments မှာ\nအောက်ကလို လောင်းကြေးတင်နိုင်ပါပြီ\n\n' +
    '👉 <code>.2d 00.33.66 5000</code>\n' +
    '👉 <code>.2d 45R 5000</code>\n\n' + emoji('LUCKY', '🍀') + ' <b>ကံကောင်းပါစေရှင့်</b> ' + emoji('LUCKY', '🍀') + test;
}
function closeText(e) {
  return emoji('LOCK', '🔒') + ' <b>Bet ပိတ်လိုက်ပါပြီရှင့်</b>\n━━━━━━━━━━━━━━━━━━\n' +
    emoji('DATE', '📅') + ' ' + escHtml(dateTime(e.closeAt)) + '\n\n' +
    emoji('WAIT', '🎯') + ' ပေါက်ဂဏန်းထွက်ရန် အချိန်ကို စောင့်နေပါသည်။\n\n' +
    emoji('LUCKY', '🍀') + ' အားလုံး ကံကောင်းကြပါစေရှင့် ' + emoji('LUCKY', '🍀');
}
function resultText(e) {
  return emoji('WIN', '🏆') + ' <b>BIKA 2D ပေါက်ဂဏန်းထွက်ပါပြီ</b>\n━━━━━━━━━━━━━━━━━━\n' +
    emoji('DATE', '📅') + ' <b>' + escHtml(dateTime(e.resultAt)) + '</b>\n\n' +
    emoji('NUMBER', '🎯') + ' ပေါက်ဂဏန်း <b>' + e.winningNumber + '</b>\n\n' +
    emoji('COMMENT', '🎉') + ' ကံထူးရှင်များစာရင်းကို Comment မှာ ဝင်ကြည့်နိုင်ပါတယ်ရှင့်\n\n'
    emoji('LUCKY', '🍀') + ' ကံထူးရှင်အားလုံး ဂုဏ်ယူပါတယ် ' + emoji('LUCKY', '🍀');
}
async function createEvent(id, key, open, close, manual) {
  const doc = { eventId: id, dateKey: key, openAt: yangonDateAt(key, open), closeAt: yangonDateAt(key, close), status: 'scheduled', manual: !!manual, channelId: env.TWO_D_CHANNEL_ID, discussionChatId: null, discussionRootMessageId: null, openMessageId: null, closeMessageId: null, resultMessageId: null, winningNumber: null, resultAt: null, createdAt: new Date(), updatedAt: new Date() };
  try { await events().insertOne(doc); return doc; } catch (e) { if (e && e.code === 11000) return getEvent(id); throw e; }
}
async function publishOpen(bot, e) {
  const d = await discussionId(bot);
  const sent = await safeTelegram(function () { return bot.telegram.sendMessage(env.TWO_D_CHANNEL_ID, openText(e), { parse_mode: 'HTML', disable_web_page_preview: true }); });
  await events().updateOne({ eventId: e.eventId, status: 'scheduled' }, { $set: { status: 'open', openMessageId: sent.message_id, discussionChatId: d, updatedAt: new Date() } });
  return getEvent(e.eventId);
}
async function closeEvent(bot, e) {
  const claim = await events().findOneAndUpdate({ eventId: e.eventId, status: 'open' }, { $set: { status: 'closed', updatedAt: new Date() } }, { returnDocument: 'after' });
  const closed = claim && claim.value !== undefined ? claim.value : claim;
  if (!closed) return null;
  try {
    const d = closed.discussionChatId ? Number(closed.discussionChatId) : await discussionId(bot);
    if (d && closed.openMessageId) {
      await safeTelegram(function () {
        return bot.telegram.sendMessage(d, closeText(closed), {
          parse_mode: 'HTML',
          reply_parameters: {
            message_id: Number(closed.openMessageId),
            chat_id: env.TWO_D_CHANNEL_ID,
          },
        });
      });
    } else {
      logger.warn('2D close comment skipped: linked discussion or open post is unavailable for ' + closed.eventId);
    }
  } catch (err) { logger.error('2D close comment failed', err); }
  try {
    await safeTelegram(function () { return bot.telegram.sendMessage(env.OWNER_ID, '🔔 <b>Bet ပိတ်ပြီးပါပြီ</b>\n\n📅 ' + escHtml(dateTime(closed.openAt)) + '\n⏰ ' + escHtml(displayTime(closed.closeAt)) + '\n\nပေါက်ဂဏန်းထွက်ပြီးရင် <code>/2dwin 45</code> လိုမျိုး သတ်မှတ်ပေးပါရှင့်။', { parse_mode: 'HTML' }); });
  } catch (err) { logger.error('2D owner DM failed', err); }
  return getEvent(e.eventId);
}
async function isEventMessage(message, e) {
  if (!message || !e || e.status !== 'open') return false;
  if (Number(message.chat && message.chat.id) !== Number(e.discussionChatId)) return false;
  if (e.discussionRootMessageId && Number(message.message_thread_id) === Number(e.discussionRootMessageId)) return true;
  const r = message.reply_to_message || {};
  const originChat = r.forward_origin && r.forward_origin.chat ? r.forward_origin.chat.id : (r.sender_chat && r.sender_chat.id);
  const originMessage = r.forward_origin && r.forward_origin.message_id ? r.forward_origin.message_id : r.message_id;
  if (Number(originChat) === Number(e.channelId) && Number(originMessage) === Number(e.openMessageId)) {
    const root = Number(message.message_thread_id || r.message_id);
    if (root) await events().updateOne({ eventId: e.eventId, discussionRootMessageId: null }, { $set: { discussionRootMessageId: root, updatedAt: new Date() } });
    return true;
  }
  if (r.is_automatic_forward && Number(r.sender_chat && r.sender_chat.id) === Number(e.channelId)) {
    const root = Number(message.message_thread_id || r.message_id);
    if (root) await events().updateOne({ eventId: e.eventId, discussionRootMessageId: null }, { $set: { discussionRootMessageId: root, updatedAt: new Date() } });
    return true;
  }
  return false;
}
async function addBet(ctx, e, parsed) {
  const userId = Number(ctx.from && ctx.from.id);
  if (!userId) throw new Error('USER_REQUIRED');
  const sourceChatId = Number(ctx.chat.id), sourceMessageId = Number(ctx.message.message_id), now = new Date();
  const old = await bets().findOne({ eventId: e.eventId, sourceChatId: sourceChatId, sourceMessageId: sourceMessageId });
  if (old) return { duplicate: true, lines: old.lines, total: old.total, balance: null };
  if (!(await userModel.collection().findOne({ userId: userId }))) throw new Error('USER_NOT_STARTED');
  let debited = false;
  const appliedLines = [];
  const out = await withMaybeTx(async function (session) {
    const opt = session ? { session: session, returnDocument: 'after' } : { returnDocument: 'after' };
    const u0 = await userModel.collection().findOneAndUpdate({ userId: userId, balance: { $gte: parsed.total } }, { $inc: { balance: -parsed.total, totalLost: parsed.total }, $set: { updatedAt: now } }, opt);
    const u = u0 && u0.value !== undefined ? u0.value : u0;
    if (!u) throw new Error('USER_INSUFFICIENT');
    debited = true;
    try {
      for (const line of parsed.lines) {
        const p0 = await positions().findOneAndUpdate({ eventId: e.eventId, userId: userId, number: line.number, totalAmount: { $lte: MAX_PER_NUMBER - line.amount } }, { $inc: { totalAmount: line.amount }, $set: { updatedAt: now }, $setOnInsert: { eventId: e.eventId, userId: userId, number: line.number, createdAt: now, username: ctx.from.username ? String(ctx.from.username).toLowerCase() : null, firstName: ctx.from.first_name || null } }, Object.assign({ upsert: true, returnDocument: 'after' }, session ? { session: session } : {}));
        const p = p0 && p0.value !== undefined ? p0.value : p0;
        if (!p || Number(p.totalAmount) > MAX_PER_NUMBER) throw new Error('LIMIT_' + line.number);
        appliedLines.push(line);
      }
      await bets().insertOne({ eventId: e.eventId, userId: userId, sourceChatId: sourceChatId, sourceMessageId: sourceMessageId, username: ctx.from.username ? String(ctx.from.username).toLowerCase() : null, firstName: ctx.from.first_name || null, lastName: ctx.from.last_name || null, lines: parsed.lines, total: parsed.total, createdAt: now }, session ? { session: session } : {});

      // The player's stake has already been deducted above. Move the same amount
      // into the actual Bot Bank (the same treasury used by /treasury and economyService)
      // so 2D payouts have a real, auditable funding source.
      const treasury0 = await treasury().findOneAndUpdate(
        { key: 'treasury' },
        { $inc: { ownerBalance: parsed.total }, $set: { updatedAt: now } },
        Object.assign({ returnDocument: 'after' }, session ? { session: session } : {})
      );
      const treasuryDoc = treasury0 && treasury0.value !== undefined ? treasury0.value : treasury0;
      if (!treasuryDoc) throw new Error('TREASURY_NOT_READY');

      await logTx({ type: '2d_bet', fromUserId: userId, toUserId: 'TREASURY', amount: parsed.total, meta: { eventId: e.eventId, lines: parsed.lines } }, session ? { session: session } : {});
      return { balance: Number(u.balance) - parsed.total };
    } catch (err) {
      if (!session && debited) {
        await userModel.collection().updateOne({ userId: userId }, { $inc: { balance: parsed.total, totalLost: -parsed.total }, $set: { updatedAt: new Date() } });
        await treasury().updateOne({ key: 'treasury' }, { $inc: { ownerBalance: -parsed.total }, $set: { updatedAt: new Date() } });
        for (const line of appliedLines) await positions().updateOne({ eventId: e.eventId, userId: userId, number: line.number }, { $inc: { totalAmount: -line.amount } });
      }
      throw err;
    }
  });
  return { duplicate: false, lines: parsed.lines, display: parsed.display, total: parsed.total, balance: out.balance };
}
function betComplete(e, r) {
  const list = (r.display || r.lines.map(function (x) { return { label: x.number, amount: x.amount, multiplier: 1 }; })).map(function (x) {
    return '<code>' + x.label + '</code> - <b>' + fmt(x.amount) + '</b>' + (x.multiplier > 1 ? '×' + x.multiplier : '');
  }).join('\n');
  return emoji('BET', '🎯') + ' <b>BET COMPLETE</b>\n━━━━━━━━━━━━━━━━━━\n' +
    '📅 ' + escHtml(dateTime(e.openAt)) + '\n' +
    '<b>TOTAL BET LIST</b>\n\n' + list + '\n\n' +
    '💰 <b>TOTAL BET = ' + fmt(r.total) + '</b>\n' +
    '💳 Balance = <b>' + fmt(r.balance) + '</b>\n\n' +
    emoji('LUCKY', '🍀') + 'ကံကောင်းပါစေရှင့် ' + emoji('LUCKY', '🍀');
}
async function handleBet(ctx, e, parsed) {
  const r = await addBet(ctx, e, parsed);
  if (r.duplicate) return ctx.reply('⚠️ ဒီ message ကို အရင်က လက်ခံပြီးသားပါ။', { reply_to_message_id: ctx.message.message_id });
  return safeTelegram(function () { return ctx.reply(betComplete(e, r), { parse_mode: 'HTML', disable_web_page_preview: true, reply_to_message_id: ctx.message.message_id }); });
}
async function handleComment(ctx, bot) {
  const e = await openEvent();
  if (!e || !(await isEventMessage(ctx.message, e))) return false;
  if (owner(ctx)) return false;
  const text = String(ctx.message.text || '').trim();
  if (!/^\.2d(?:\s|$)/i.test(text)) { await safeTelegram(function () { return bot.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id); }).catch(function () {}); return true; }
  const parsed = parse2dCommand(text);
  if (parsed.error) { await safeTelegram(function () { return bot.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id); }).catch(function () {}); return true; }
  try { await handleBet(ctx, e, parsed); } catch (err) {
    let msg = '⚠️ Bet လက်ခံရာမှာ အမှားဖြစ်သွားပါတယ်။'; const s = String(err.message || err);
    if (s === 'USER_INSUFFICIENT') msg = '💳 Balance မလုံလောက်ပါဘူး။';
    else if (s === 'USER_NOT_STARTED') msg = '⚠️ Bot ကို အရင် <code>/start</code> လုပ်ပေးပါ။';
    else if (s.indexOf('LIMIT_') === 0) msg = '⛔ <code>' + escHtml(s.slice(6)) + '</code> ကို တစ်ယောက်လျှင် စုစုပေါင်း <b>' + fmt(MAX_PER_NUMBER) + '</b> အထိပဲ ထိုးနိုင်ပါတယ်။';
    await safeTelegram(function () { return ctx.reply(msg, { parse_mode: 'HTML', reply_to_message_id: ctx.message.message_id }); }).catch(function () {});
  }
  return true;
}
async function myBet(ctx) {
  const e = await openEvent() || await events().findOne({ channelId: env.TWO_D_CHANNEL_ID, status: { $in: ['closed', 'result'] } }, { sort: { openAt: -1 } });
  if (!e) return ctx.reply('📋 2D Event မရှိသေးပါဘူး။');
  const rows = await positions().find({ eventId: e.eventId, userId: Number(ctx.from.id) }).sort({ number: 1 }).toArray();
  if (!rows.length) return ctx.reply('📋 <b>MY BET</b>\n━━━━━━━━━━━━━━━━━━\nဒီ Event မှာ ထိုးထားတာ မရှိသေးပါဘူး။', { parse_mode: 'HTML' });
  const total = rows.reduce(function (s, x) { return s + Number(x.totalAmount); }, 0);
  return ctx.reply('📋 <b>MY BET</b>\n━━━━━━━━━━━━━━━━━━\n📅 ' + escHtml(dateTime(e.openAt)) + '\n\n' + rows.map(function (x) { return '🎯 <code>' + x.number + '</code> — <b>' + fmt(x.totalAmount) + '</b>'; }).join('\n') + '\n\n💰 TOTAL BET = <b>' + fmt(total) + '</b>', { parse_mode: 'HTML' });
}
async function winners(e, number) {
  const rows = await positions().find({ eventId: e.eventId, number: number }).sort({ totalAmount: -1, userId: 1 }).toArray();
  return rows.map(function (x) { return { userId: x.userId, name: x.firstName || x.username || 'Player', amount: Number(x.totalAmount), payout: Number(x.totalAmount) * PAYOUT }; });
}
function winnerText(rows) {
  if (!rows.length) return emoji('WIN', '🏆') + ' <b>ကံထူးရှင်များ</b>\n━━━━━━━━━━━━━━━━━━\nဒီအကြိမ်မှာ ကံထူးရှင် တစ်ယောက်မှ မရှိပါဘူးရှင့်။';
  const top = rows.slice(0, 10);
  const lines = top.map(function (x, i) { return (i + 1) + '. <a href="tg://user?id=' + x.userId + '">' + escHtml(x.name) + '</a> — <b>' + fmt(x.amount) + '</b> × ' + PAYOUT + ' = <b>' + fmt(x.payout) + '</b>'; });
  if (rows.length > 10) lines.push('', '➕ <b>And More ' + (rows.length - 10) + '+....</b>');
  return emoji('WIN', '🏆') + ' <b>BIKA 2D ကံထူးရှင်များ</b>\n━━━━━━━━━━━━━━━━━━\n' + lines.join('\n') + '\n\n' + emoji('LUCKY', '🍀') + ' ကံထူးရှင်အားလုံး ဂုဏ်ယူပါတယ်';
}
async function settle(e, number) {
  const current = await getEvent(e.eventId);
  if (!current || !['closed', 'settling'].includes(current.status) || current.resultAt) {
    throw new Error('RESULT_ALREADY_SETTLED');
  }
  if (current.status === 'settling' && current.winningNumber && current.winningNumber !== number) {
    throw new Error('SETTLEMENT_IN_PROGRESS');
  }

  // Atomically claim the event. If another request already claimed it, resume that same settlement.
  if (current.status === 'closed') {
    const claim0 = await events().findOneAndUpdate(
      { eventId: e.eventId, status: 'closed', resultAt: null },
      { $set: { status: 'settling', winningNumber: number, settlementStartedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const claim = claim0 && claim0.value !== undefined ? claim0.value : claim0;
    if (!claim) {
      const locked = await getEvent(e.eventId);
      if (!locked || locked.status !== 'settling' || locked.winningNumber !== number) throw new Error('SETTLEMENT_IN_PROGRESS');
    }
  }

  const lockedEvent = await getEvent(e.eventId);
  const rows = await winners(lockedEvent, number);
  const total = rows.reduce(function (s, x) { return s + x.payout; }, 0);
  const now = new Date();
  const treasuryKey = treasurySettlementKey(lockedEvent.eventId);

  await withMaybeTx(async function (session) {
    const opt = session ? { session: session } : {};

    // Treasury debit is itself idempotent. In fallback mode, the same event can safely resume.
    if (total) {
      const t = await treasury().findOneAndUpdate(
        { key: 'treasury', ownerBalance: { $gte: total }, twoDSettlementKeys: { $ne: treasuryKey } },
        { $inc: { ownerBalance: -total }, $addToSet: { twoDSettlementKeys: treasuryKey }, $set: { updatedAt: now } },
        Object.assign({ returnDocument: 'after' }, opt)
      );
      const treasuryDoc = t && t.value !== undefined ? t.value : t;
      if (!treasuryDoc) {
        const already = await treasury().findOne({ key: 'treasury', twoDSettlementKeys: treasuryKey });
        if (!already) throw new Error('TREASURY_INSUFFICIENT');
      }
    }

    for (const x of rows) {
      const key = settlementKey(lockedEvent.eventId, x.userId);
      const u = await userModel.collection().updateOne(
        { userId: x.userId, [USER_SETTLEMENT_KEYS]: { $ne: key } },
        { $inc: { balance: x.payout, totalWon: x.payout }, $addToSet: { [USER_SETTLEMENT_KEYS]: key }, $set: { updatedAt: now } },
        opt
      );

      // If the marker was already present, the balance was credited in an earlier attempt.
      // Only the transaction-log repair remains.
      const txFilter = { type: '2d_win', fromUserId: 'TREASURY', toUserId: x.userId, 'meta.eventId': lockedEvent.eventId, 'meta.winningNumber': number };
      if (u.modifiedCount === 0) {
        const existingTx = await col('transactions').findOne(txFilter, opt);
        if (!existingTx) {
          await logTx({ type: '2d_win', fromUserId: 'TREASURY', toUserId: x.userId, amount: x.payout, meta: { eventId: lockedEvent.eventId, winningNumber: number } }, opt);
        }
      } else {
        const existingTx = await col('transactions').findOne(txFilter, opt);
        if (!existingTx) {
          await logTx({ type: '2d_win', fromUserId: 'TREASURY', toUserId: x.userId, amount: x.payout, meta: { eventId: lockedEvent.eventId, winningNumber: number } }, opt);
        }
      }
    }

    await events().updateOne(
      { eventId: lockedEvent.eventId, status: 'settling', winningNumber: number, resultAt: null },
      { $set: { status: 'result', resultAt: now, winnerCount: rows.length, totalPayout: total, settlementCompletedAt: now, updatedAt: now } },
      opt
    );
  });

  return { rows: rows, total: total, resultAt: now };
}
async function verifyDailySettlement(event) {
  if (!event || event.status !== 'result' || !event.resultAt) return false;
  const winnerCount = Number(event.winnerCount || 0);
  const totalPayout = Number(event.totalPayout || 0);
  const txAgg = await col('transactions').aggregate([
    { $match: { type: '2d_win', 'meta.eventId': event.eventId } },
    { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$amount' } } }
  ]).toArray();
  const tx = txAgg[0] || { count: 0, total: 0 };
  return Number(tx.count) === winnerCount && Number(tx.total) === totalPayout;
}

async function cleanupDay(key) {
  if (!env.TWO_D_CHANNEL_ID || weekend(key) || await offDate(key)) return false;

  const ids = ['auto-' + key + '-am', 'auto-' + key + '-pm'];
  const dayEvents = await events().find({ eventId: { $in: ids }, manual: false }).toArray();
  if (dayEvents.length !== 2) return false;
  if (!dayEvents.every(function (x) { return x.status === 'result' && x.resultAt; })) return false;

  for (const e of dayEvents) {
    if (!(await verifyDailySettlement(e))) {
      logger.warn('2D daily cleanup blocked: settlement verification failed for ' + e.eventId);
      return false;
    }
  }

  const eventIds = dayEvents.map(function (x) { return x.eventId; });
  const cleanupFilter = { eventId: { $in: eventIds } };

  // Remove only temporary 2D runtime data. User balances and the permanent transaction ledger stay intact.
  await bets().deleteMany(cleanupFilter);
  await positions().deleteMany(cleanupFilter);
  await events().deleteMany({ eventId: { $in: eventIds }, status: 'result' });

  // Remove only the short-lived idempotency markers created for this day's 2D settlements.
  await userModel.collection().updateMany(
    { [USER_SETTLEMENT_KEYS]: { $exists: true } },
    { $pull: { [USER_SETTLEMENT_KEYS]: { $regex: '^(?:' + eventIds.join('|') + '):' } } }
  );
  await treasury().updateOne(
    { key: 'treasury' },
    { $pull: { twoDSettlementKeys: { $in: eventIds.map(treasurySettlementKey) } }, $set: { updatedAt: new Date() } }
  );

  logger.info('2D daily cleanup completed: ' + key + ' (AM + PM)');
  return true;
}

async function publishResult(bot, e, number) {
  const settled = await settle(e, number);
  const updated = await getEvent(e.eventId);
  const sent = await safeTelegram(function () { return bot.telegram.sendMessage(env.TWO_D_CHANNEL_ID, resultText(updated), { parse_mode: 'HTML', disable_web_page_preview: true }); });
  await events().updateOne({ eventId: e.eventId }, { $set: { resultMessageId: sent.message_id, updatedAt: new Date() } });
  try {
    const d = updated.discussionChatId ? Number(updated.discussionChatId) : await discussionId(bot);
    if (d && sent && sent.message_id) {
      await safeTelegram(function () {
        return bot.telegram.sendMessage(d, winnerText(settled.rows), {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_parameters: {
            message_id: Number(sent.message_id),
            chat_id: env.TWO_D_CHANNEL_ID,
          },
        });
      });
    } else {
      logger.warn('2D winner comment skipped: linked discussion or result post is unavailable for ' + updated.eventId);
    }
  } catch (err) {
    logger.error('2D winner comment failed', err);
  }
  return { event: updated, winners: settled.rows, totalPayout: settled.total };
}
async function setManual(ctx, bot) {
  if (!owner(ctx)) return ctx.reply('⛔ Owner only.');
  if (!env.TWO_D_CHANNEL_ID) return ctx.reply('⚠️ TWO_D_CHANNEL_ID ကို env မှာ သတ်မှတ်ပေးပါ။');

  // Supported:
  // /set2d 24/9/2026 7:31PM /offbet 7:35PM
  // /set2d 24/9/2026 7:31PM / offbet 7:35PM
  // /set2d@BikaGameBot 24/9/2026 7:31PM offbet 7:35PM
  const text = String(ctx.message?.text || '').trim();
  const m = text.match(/^\/set2d(?:@\w+)?\s+(\d{1,2}[\/.-]\d{1,2}[\/.-]\d{4})\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*(?:\/\s*)?offbet\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\s*$/i);

  if (!m) {
    return ctx.reply('အသုံးပြုပုံ: <code>/set2d 24/9/2026 7:31PM /offbet 7:35PM</code>', { parse_mode: 'HTML' });
  }

  const dk = parseDateInput(m[1]);
  const open = parseTimeInput(m[2]);
  const close = parseTimeInput(m[3]);
  if (!dk || !open || !close) {
    return ctx.reply('⚠️ Date/Time ပုံစံမှားနေပါတယ်။', { parse_mode: 'HTML' });
  }

  const oa = yangonDateAt(dk, open);
  const ca = yangonDateAt(dk, close);
  const now = new Date();

  if (ca <= oa) return ctx.reply('⚠️ Offbet time က Open time ထက် နောက်ကျရပါမယ်။');
  if (ca <= now) return ctx.reply('⚠️ သတ်မှတ်ထားတဲ့ Offbet အချိန်က လက်ရှိအချိန်ထက် ကျော်လွန်နေပါပြီ။');

  try {
    const e = await createEvent('manual-' + dk + '-' + open + '-' + Date.now(), dk, open, close, true);

    // When /set2d is sent after the requested open time but before offbet,
    // publish immediately instead of waiting for the scheduler.
    let published = false;
    if (now >= oa && now < ca) {
      const p = await publishOpen(bot, e);
      published = !!p;
    }

    return ctx.reply(
      '✅ <b>2D Manual Post ' + (published ? 'ဖွင့်ပြီးပါပြီ' : 'Scheduled လုပ်ပြီးပါပြီ') + '</b>\n\n' +
      '📅 <b>' + escHtml(dateTime(e.openAt)) + '</b>\n' +
      '🔒 <b>' + escHtml(displayTime(e.closeAt)) + '</b> မှာ Bet ပိတ်ပါမယ်။\n' +
      '📢 Channel ID: <code>' + escHtml(String(env.TWO_D_CHANNEL_ID)) + '</code>',
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    logger.error('2D manual set failed', err);
    return ctx.reply(
      '⚠️ <b>2D Manual Post သတ်မှတ်ရာမှာ အမှားဖြစ်သွားပါတယ်။</b>\n<code>' +
      escHtml(String(err.message || err)) + '</code>',
      { parse_mode: 'HTML' }
    );
  }
}
function register(bot) {
  bot.hears(/^\.mybet\s*$/i, async function (ctx) { try { await myBet(ctx); } catch (e) { logger.error('2D mybet', e); } });
  bot.command('set2d', function (ctx) { return setManual(ctx, bot); });
  bot.command('offdate', async function (ctx) {
    if (!owner(ctx)) return ctx.reply('⛔ Owner only.');
    const raw = String(ctx.message.text || '').replace(/^\/offdate(?:@\w+)?\s*/i, '').trim();
    if (!raw) { const rows = await offdates().find({}).sort({ dateKey: 1 }).limit(30).toArray(); return ctx.reply(rows.length ? '<b>2D Off Dates</b>\n\n' + rows.map(function (x) { return '• ' + x.dateKey; }).join('\n') : 'Off date မရှိသေးပါ။', { parse_mode: 'HTML' }); }
    const rm = /^remove\s+(.+)$/i.exec(raw), dk = parseDateInput(rm ? rm[1] : raw);
    if (!dk) return ctx.reply('⚠️ Date ပုံစံ: <code>5/9/2026</code>', { parse_mode: 'HTML' });
    if (rm) { await offdates().deleteOne({ dateKey: dk }); return ctx.reply('✅ Off date ဖယ်ရှားပြီးပါပြီ — <code>' + dk + '</code>', { parse_mode: 'HTML' }); }
    await offdates().updateOne({ dateKey: dk }, { $set: { dateKey: dk, updatedAt: new Date() } }, { upsert: true });
    return ctx.reply('✅ Auto 2D schedule ပိတ်ထားပါပြီ — <code>' + dk + '</code>', { parse_mode: 'HTML' });
  });
  bot.command('2dwin', async function (ctx) {
    if (!owner(ctx)) return ctx.reply('⛔ Owner only.');
    if (ctx.chat.type !== 'private') return ctx.reply('🔒 <code>/2dwin</code> ကို Owner DM မှာပဲ သုံးပါ။', { parse_mode: 'HTML' });
    const raw = String(ctx.message.text || '').replace(/^\/2dwin(?:@\w+)?\s*/i, '').trim();
    if (!/^\d{1,2}$/.test(raw)) return ctx.reply('အသုံးပြုပုံ: <code>/2dwin 45</code>', { parse_mode: 'HTML' });
    const number = raw.padStart(2, '0'); if (+number > 99) return ctx.reply('⚠️ 00 မှ 99 အတွင်းပဲ သတ်မှတ်နိုင်ပါတယ်။');
    const e = await pendingResult(); if (!e) return ctx.reply('⏳ ပိတ်ပြီးသား 2D Event မရှိသေးပါ။');
    try { const r = await publishResult(bot, e, number); return ctx.reply('✅ <b>2D Result Published</b>\n\n🎯 Winning Number: <b>' + number + '</b>\n🏆 Winners: <b>' + r.winners.length + '</b>\n💰 Total Payout: <b>' + fmt(r.totalPayout) + '</b>', { parse_mode: 'HTML' }); }
    catch (err) { logger.error('2D win failed', err); const code = String(err.message || err); return ctx.reply(code === 'TREASURY_INSUFFICIENT' ? '⚠️ Winner payout အတွက် Treasury balance မလုံလောက်ပါ။ Result မထုတ်သေးပါ။' : code === 'SETTLEMENT_IN_PROGRESS' ? '⏳ 2D Result settlement လုပ်နေဆဲပါ။ ခဏစောင့်ပြီး ထပ်စမ်းပါ။' : code === 'RESULT_ALREADY_SETTLED' ? 'ℹ️ ဒီ 2D Result ကို အရင်က settle လုပ်ပြီးသားပါ။' : '⚠️ 2D Result ထုတ်ရာမှာ အမှားဖြစ်သွားပါတယ်။'); }
  });
  bot.hears(/^\.2d(?:\s|$)/i, async function (ctx, next) {
    const e = await openEvent(); if (!e || !(await isEventMessage(ctx.message, e))) return next();
    if (owner(ctx)) return next();
    const p = parse2dCommand(ctx.message.text); if (p.error) { await handleComment(ctx, bot); return; }
    try { await handleBet(ctx, e, p); } catch (err) { await handleComment(ctx, bot); }
  });
}
async function init(bot) {
  await events().createIndex({ eventId: 1 }, { unique: true, name: 'two_d_events_event_unique' });
  await events().createIndex({ channelId: 1, status: 1, openAt: -1 }, { name: 'two_d_events_channel_status' });
  await events().createIndex({ status: 1, closeAt: 1 }, { name: 'two_d_events_close' });
  await bets().createIndex({ eventId: 1, userId: 1, createdAt: -1 }, { name: 'two_d_bets_user' });
  await bets().createIndex({ eventId: 1, sourceChatId: 1, sourceMessageId: 1 }, { unique: true, name: 'two_d_bets_source_unique' });
  await positions().createIndex({ eventId: 1, userId: 1, number: 1 }, { unique: true, name: 'two_d_positions_unique' });
  await positions().createIndex({ eventId: 1, number: 1, totalAmount: -1 }, { name: 'two_d_positions_number' });
  await offdates().createIndex({ dateKey: 1 }, { unique: true, name: 'two_d_offdates_unique' });
  if (!env.TWO_D_CHANNEL_ID) { logger.warn('2D scheduler disabled: TWO_D_CHANNEL_ID is not configured'); return function () {}; }
  let busy = false;
  const tick = async function () {
    if (busy) return; busy = true;
    try {
      const now = new Date(), today = dateKey(now);
      const scheduled = await events().find({ channelId: env.TWO_D_CHANNEL_ID, status: 'scheduled', openAt: { $lte: now } }).limit(10).toArray();
      for (const e of scheduled) await publishOpen(bot, e);
      const closing = await events().find({ channelId: env.TWO_D_CHANNEL_ID, status: 'open', closeAt: { $lte: now } }).limit(10).toArray();
      for (const e of closing) await closeEvent(bot, e);
      // Retry yesterday as well, so a restart after the previous day's PM result cannot leave stale 2D data behind.
      const yesterday = new Date(now.getTime() - 86400000);
      await cleanupDay(dateKey(yesterday));
      await cleanupDay(today);
      if (!weekend(today) && !(await offDate(today))) {
        for (const s of SCHEDULE) {
          const oa = yangonDateAt(today, s.open), ca = yangonDateAt(today, s.close), id = 'auto-' + today + '-' + s.key;
          if (now >= oa && now < ca && now.getTime() - oa.getTime() <= 90000 && !(await getEvent(id))) { const e = await createEvent(id, today, s.open, s.close, false); await publishOpen(bot, e); }
        }
      }
    } catch (err) { logger.error('2D scheduler tick failed', err); } finally { busy = false; }
  };
  await tick(); const timer = setInterval(tick, 15000); return function () { clearInterval(timer); };
}
module.exports = { register: register, init: init, handleComment: handleComment };