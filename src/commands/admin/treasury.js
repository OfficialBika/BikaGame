'use strict';

const { COIN } = require('../../config/constants');
const { ensureTreasury, getTreasury, isOwner, setTotalSupply, setVipWinRate, setRtpWinRate } = require('../../services/treasuryService');
const { parseAmount } = require('../../utils/helpers');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function parsePercent(text) {
  const raw = String(text || '').trim().split(/\s+/)[1];
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.floor(n)));
}

async function requireOwner(ctx) {
  const t = await ensureTreasury();
  if (!isOwner(ctx, t)) {
    await replyHTML(ctx, '⛔ Owner only.', replyOptions(ctx));
    return null;
  }
  return t;
}

module.exports = (bot) => {
  bot.command('settotal', async (ctx) => {
    const t = await requireOwner(ctx);
    if (!t) return;

    const amount = parseAmount(ctx.message.text);
    if (!amount || amount <= 0) return replyHTML(ctx, 'Usage: <code>/settotal 5000000</code>', replyOptions(ctx));

    await setTotalSupply(amount);
    const tr = await getTreasury();

    return replyHTML(ctx, `🏦 <b>Treasury Initialized</b>\n━━━━━━━━━━━━━━\n• Total Supply: <b>${fmt(tr.totalSupply)}</b> ${COIN}\n• Owner Balance: <b>${fmt(tr.ownerBalance)}</b> ${COIN}`, replyOptions(ctx));
  });

  bot.command('treasury', async (ctx) => {
    const t = await requireOwner(ctx);
    if (!t) return;

    const tr = await getTreasury();

    return replyHTML(ctx, `🏦 <b>Treasury Dashboard</b>\n━━━━━━━━━━━━━━\n• Total Supply: <b>${fmt(tr.totalSupply)}</b> ${COIN}\n• Owner Balance: <b>${fmt(tr.ownerBalance)}</b> ${COIN}\n• Owner ID: <code>${tr.ownerUserId}</code>\n• VIP WR: <b>${tr.vipWinRate}%</b>\n• Slot RTP WR: <b>${tr.rtpWinRate ?? 35}%</b>\n━━━━━━━━━━━━━━\n<code>/setvipwr 90</code>\n<code>/setrtp 35</code>`, replyOptions(ctx));
  });

  bot.command('setvipwr', async (ctx) => {
    const t = await requireOwner(ctx);
    if (!t) return;

    const rate = parsePercent(ctx.message.text);
    if (rate == null) return replyHTML(ctx, 'Usage: <code>/setvipwr 90</code>', replyOptions(ctx));

    const n = await setVipWinRate(rate);
    return replyHTML(ctx, `✅ VIP Win Rate Updated: <b>${n}%</b>`, replyOptions(ctx));
  });

  bot.command('vipwr', async (ctx) => {
    const t = await requireOwner(ctx);
    if (!t) return;
    return replyHTML(ctx, `📊 VIP Win Rate: <b>${t.vipWinRate}%</b>`, replyOptions(ctx));
  });

  bot.command('setrtp', async (ctx) => {
    const t = await requireOwner(ctx);
    if (!t) return;

    const rate = parsePercent(ctx.message.text);
    if (rate == null) return replyHTML(ctx, 'Usage: <code>/setrtp 35</code>\n0 = win နည်း | 100 = win များ', replyOptions(ctx));

    const n = await setRtpWinRate(rate);
    return replyHTML(ctx, `🎰 <b>Slot RTP WinRate Updated</b>\n━━━━━━━━━━━━━━\nNew RTP WR: <b>${n}%</b>`, replyOptions(ctx));
  });

  bot.command('rtp', async (ctx) => {
    const t = await requireOwner(ctx);
    if (!t) return;

    return replyHTML(ctx, `🎰 <b>Slot RTP WinRate</b>\n━━━━━━━━━━━━━━\nCurrent: <b>${t.rtpWinRate ?? 35}%</b>\nChange: <code>/setrtp 35</code>`, replyOptions(ctx));
  });
};
