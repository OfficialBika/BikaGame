'use strict';

const { COIN } = require('../../config/constants');
const { ensureTreasury, getTreasury, isOwner, setTotalSupply, setVipWinRate, setRtpWinRate } = require('../../services/treasuryService');
const { getUser, ensureUser, treasuryPayToUser, userPayToTreasury } = require('../../services/economyService');
const { parseAmount, mentionHtml, userDocLabelHtml } = require('../../utils/helpers');
const { replyHTML } = require('../../utils/telegram');
const { fmt, escHtml } = require('../../utils/format');

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

function parseNumberToken(value) {
  const n = Number(String(value || '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}

function parseBalanceCommand(ctx) {
  const parts = String(ctx.message?.text || '').trim().split(/\s+/).filter(Boolean);
  const replyUser = ctx.message?.reply_to_message?.from || null;

  if (replyUser) {
    const amount = parseNumberToken(parts[1]);

    return {
      targetUser: replyUser,
      targetUserId: replyUser.id,
      amount,
      mode: 'reply',
    };
  }

  const targetUserId = parseNumberToken(parts[1]);
  const amount = parseNumberToken(parts[2]);

  return {
    targetUser: null,
    targetUserId,
    amount,
    mode: 'userid',
  };
}

function balanceUsage(command) {
  return (
    `Usage:\n` +
    `Reply နဲ့: <code>/${command} 10000</code>\n` +
    `User ID နဲ့: <code>/${command} 123456789 10000</code>`
  );
}

async function requireOwner(ctx) {
  const t = await ensureTreasury();
  if (!isOwner(ctx, t)) {
    await replyHTML(ctx, '⛔ Owner only.', replyOptions(ctx));
    return null;
  }
  return t;
}

async function runAdminBalanceAdjust(ctx, type) {
  const t = await requireOwner(ctx);
  if (!t) return;

  const command = type === 'add' ? 'addbal' : 'rmbal';
  const parsed = parseBalanceCommand(ctx);

  if (!parsed.targetUserId || parsed.targetUserId <= 0 || !parsed.amount || parsed.amount <= 0) {
    return replyHTML(ctx, balanceUsage(command), replyOptions(ctx));
  }

  if (parsed.targetUser) {
    await ensureUser(parsed.targetUser);
  }

  const beforeUser = await getUser(parsed.targetUserId);
  const beforeBalance = Number(beforeUser?.balance || 0);

  try {
    if (type === 'add') {
      await treasuryPayToUser(parsed.targetUserId, parsed.amount, {
        type: 'owner_addbal',
        byUserId: ctx.from.id,
        mode: parsed.mode,
      });
    } else {
      await userPayToTreasury(parsed.targetUserId, parsed.amount, {
        type: 'owner_rmbal',
        byUserId: ctx.from.id,
        mode: parsed.mode,
      });
    }
  } catch (err) {
    const message = String(err?.message || err);

    if (message.includes('TREASURY_INSUFFICIENT')) {
      return replyHTML(
        ctx,
        `❌ <b>Bot Bank balance မလုံလောက်ပါ။</b>\n` +
          `━━━━━━━━━━━━━━\n` +
          `Need: <b>${fmt(parsed.amount)}</b> ${COIN}\n` +
          `Check: <code>/treasury</code>`,
        replyOptions(ctx)
      );
    }

    if (message.includes('USER_INSUFFICIENT')) {
      return replyHTML(
        ctx,
        `❌ <b>User balance မလုံလောက်ပါ။</b>\n` +
          `━━━━━━━━━━━━━━\n` +
          `User ID: <code>${parsed.targetUserId}</code>\n` +
          `Current: <b>${fmt(beforeBalance)}</b> ${COIN}\n` +
          `Remove: <b>${fmt(parsed.amount)}</b> ${COIN}`,
        replyOptions(ctx)
      );
    }

    return replyHTML(
      ctx,
      `⚠️ <b>Balance update error</b>\n<code>${escHtml(message)}</code>`,
      replyOptions(ctx)
    );
  }

  const afterUser = await getUser(parsed.targetUserId);
  const tr = await getTreasury();

  const targetLabel = parsed.targetUser
    ? mentionHtml(parsed.targetUser)
    : userDocLabelHtml(afterUser || { userId: parsed.targetUserId });

  const title = type === 'add'
    ? '✅ Balance Added'
    : '✅ Balance Removed';

  const sign = type === 'add' ? '+' : '-';

  return replyHTML(
    ctx,
    `${title}\n` +
      `━━━━━━━━━━━━━━\n` +
      `Target: ${targetLabel}\n` +
      `User ID: <code>${parsed.targetUserId}</code>\n` +
      `Amount: <b>${sign}${fmt(parsed.amount)}</b> ${COIN}\n` +
      `Before: <b>${fmt(beforeBalance)}</b> ${COIN}\n` +
      `After: <b>${fmt(afterUser?.balance || 0)}</b> ${COIN}\n` +
      `Bot Bank: <b>${fmt(tr?.ownerBalance || 0)}</b> ${COIN}`,
    replyOptions(ctx)
  );
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

    return replyHTML(ctx, `🏦 <b>Treasury Dashboard</b>\n━━━━━━━━━━━━━━\n• Total Supply: <b>${fmt(tr.totalSupply)}</b> ${COIN}\n• Bot Bank: <b>${fmt(tr.ownerBalance)}</b> ${COIN}\n• Owner ID: <code>${tr.ownerUserId}</code>\n• VIP WR: <b>${tr.vipWinRate}%</b>\n• Slot RTP WR: <b>${tr.rtpWinRate ?? 35}%</b>\n━━━━━━━━━━━━━━\n<code>/addbal 123456789 10000</code>\n<code>/rmbal 123456789 10000</code>\n<code>/setvipwr 90</code>\n<code>/setrtp 35</code>`, replyOptions(ctx));
  });

  bot.command('addbal', async (ctx) => {
    return runAdminBalanceAdjust(ctx, 'add');
  });

  bot.command('rmbal', async (ctx) => {
    return runAdminBalanceAdjust(ctx, 'remove');
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
