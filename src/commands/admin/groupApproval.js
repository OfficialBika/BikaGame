'use strict';

const { ensureTreasury, isOwner } = require('../../services/treasuryService');
const {
  ensureGroup,
  approve,
  reject,
  getGroup,
  setBotAdmin,
} = require('../../services/groupService');
const { replyHTML } = require('../../utils/telegram');
const { isGroupChat } = require('../../utils/helpers');
const { escHtml } = require('../../utils/format');

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function isAdminStatus(status) {
  return status === 'administrator' || status === 'creator';
}

async function checkBotAdmin(ctx) {
  try {
    const me = await ctx.telegram.getMe();
    const member = await ctx.telegram.getChatMember(ctx.chat.id, me.id);
    const status = member?.status;
    const botIsAdmin = isAdminStatus(status);

    await ensureGroup(ctx.chat);
    await setBotAdmin(ctx.chat.id, botIsAdmin);

    return {
      ok: true,
      botIsAdmin,
      status: status || 'unknown',
      username: me?.username || null,
    };
  } catch (err) {
    await ensureGroup(ctx.chat);

    return {
      ok: false,
      botIsAdmin: false,
      status: 'unknown',
      username: null,
      error: err?.message || String(err),
    };
  }
}

async function requireGroupAndOwner(ctx) {
  const options = replyOptions(ctx);

  if (!isGroupChat(ctx)) {
    await replyHTML(ctx, 'ℹ️ ဒီ command ကို group ထဲမှာပဲ သုံးပါ။', options);
    return false;
  }

  const treasury = await ensureTreasury();

  if (!isOwner(ctx, treasury)) {
    await replyHTML(
      ctx,
      `⛔ <b>Owner only.</b>\n` +
        `━━━━━━━━━━━━\n` +
        `Your ID: <code>${ctx.from?.id || 'unknown'}</code>\n` +
        `Owner ID: <code>${treasury?.ownerUserId || 'not_set'}</code>`,
      options
    );

    return false;
  }

  return true;
}

function statusText(ctx, group, adminInfo) {
  const title = escHtml(group?.title || ctx.chat?.title || 'Untitled Group');
  const approval = String(group?.approvalStatus || 'pending').toUpperCase();
  const botAdmin = adminInfo?.botIsAdmin ? 'YES ✅' : 'NO ❌';
  const botStatus = escHtml(adminInfo?.status || 'unknown');

  return (
    `👥 <b>Group Status</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Group: <b>${title}</b>\n` +
    `Group ID: <code>${ctx.chat.id}</code>\n` +
    `Bot Admin: <b>${botAdmin}</b>\n` +
    `Bot Status: <code>${botStatus}</code>\n` +
    `Owner Approval: <b>${approval}</b>\n` +
    `━━━━━━━━━━━━`
  );
}

module.exports = (bot) => {
  async function approveGroup(ctx) {
    const options = replyOptions(ctx);

    if (!(await requireGroupAndOwner(ctx))) return;

    const adminInfo = await checkBotAdmin(ctx);

    if (!adminInfo.botIsAdmin) {
      return replyHTML(
        ctx,
        `⚠️ <b>Bot ကို Admin ပေးပါ</b>\n` +
          `━━━━━━━━━━━━\n` +
          `Bot admin မရသေးလို့ group approve မလုပ်သေးပါ။\n` +
          `Bot Status: <code>${escHtml(adminInfo.status)}</code>\n` +
          `Bot ကို Admin ပေးပြီး <code>/approve</code> ပြန်ပို့ပါ။`,
        options
      );
    }

    await approve(ctx.chat.id, ctx.from.id);
    const group = await getGroup(ctx.chat.id);

    return replyHTML(
      ctx,
      `✅ <b>Group Approved</b>\n` +
        `━━━━━━━━━━━━\n` +
        `Group: <b>${escHtml(group?.title || ctx.chat.title || 'Untitled Group')}</b>\n` +
        `Bot Admin: <b>YES ✅</b>\n` +
        `Approved by: <code>${ctx.from.id}</code>`,
      options
    );
  }

  async function rejectGroup(ctx) {
    const options = replyOptions(ctx);

    if (!(await requireGroupAndOwner(ctx))) return;

    await ensureGroup(ctx.chat);
    await reject(ctx.chat.id, ctx.from.id);

    return replyHTML(
      ctx,
      `❌ <b>Group Rejected</b>\n` +
        `━━━━━━━━━━━━\n` +
        `Group: <b>${escHtml(ctx.chat.title || 'Untitled Group')}</b>\n` +
        `Rejected by: <code>${ctx.from.id}</code>`,
      options
    );
  }

  async function groupStatus(ctx) {
    const options = replyOptions(ctx);

    if (!isGroupChat(ctx)) {
      return replyHTML(ctx, 'ℹ️ ဒီ command ကို group ထဲမှာပဲ သုံးပါ။', options);
    }

    const adminInfo = await checkBotAdmin(ctx);
    const group = await getGroup(ctx.chat.id);

    return replyHTML(ctx, statusText(ctx, group, adminInfo), options);
  }

  bot.command('approve', approveGroup);
  bot.command('reject', rejectGroup);
  bot.command('groupstatus', groupStatus);

  bot.hears(/^\/?(approve|reject|groupstatus)(?:@\w+)?\s*$/i, async (ctx) => {
    const cmd = String(ctx.match?.[1] || '').toLowerCase();

    if (cmd === 'approve') return approveGroup(ctx);
    if (cmd === 'reject') return rejectGroup(ctx);
    return groupStatus(ctx);
  });
};
