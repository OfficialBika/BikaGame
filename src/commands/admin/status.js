'use strict';

const { pingMs } = require('../../config/database');
const userModel = require('../../models/userModel');
const groupModel = require('../../models/groupModel');
const { ensureTreasury, isOwner } = require('../../services/treasuryService');
const { activeDice, activeShan } = require('../../services/gameService');
const { replyHTML, editHTML } = require('../../utils/telegram');
const { fmt, uptime, formatYangon, escHtml } = require('../../utils/format');

const PAGE_SIZE = 8;

function replyOptions(ctx) {
  const messageId = ctx.message?.message_id;
  return messageId ? { reply_to_message_id: messageId } : {};
}

function cbButton(text, data, style) {
  return style
    ? { text, callback_data: data, style }
    : { text, callback_data: data };
}

function adminKeyboard() {
  return {
    inline_keyboard: [
      [
        cbButton('👥 User List', 'ADMIN:USERS:0', 'primary'),
        cbButton('👥 Group List', 'ADMIN:GROUPS:0', 'primary'),
      ],
      [
        cbButton('📝 Requests', 'ADMIN:REQUESTS:0', 'primary'),
        cbButton('🏦 Bank Tools', 'ADMIN:BANK', 'success'),
      ],
      [
        cbButton('📊 Status', 'ADMIN:STATUS', 'primary'),
        cbButton('🏓 Ping', 'ADMIN:PING', 'primary'),
      ],
    ],
  };
}

function backKeyboard() {
  return {
    inline_keyboard: [[cbButton('⬅️ Back Admin', 'ADMIN:HOME', 'primary')]],
  };
}

function listNavKeyboard(type, page, total, extraRows = []) {
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const rows = [];

  if (extraRows.length) rows.push(...extraRows);

  const nav = [];
  if (page > 0) nav.push(cbButton('⬅️ Back', `ADMIN:${type}:${page - 1}`, 'primary'));
  nav.push(cbButton(`Page ${page + 1}/${maxPage + 1}`, `ADMIN:${type}:${page}`, 'primary'));
  if (page < maxPage) nav.push(cbButton('Next ➡️', `ADMIN:${type}:${page + 1}`, 'primary'));

  rows.push(nav);
  rows.push([cbButton('🏠 Admin Home', 'ADMIN:HOME', 'primary')]);

  return { inline_keyboard: rows };
}

function userName(user) {
  const full = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
  return full || user?.username || `User ${user?.userId || user?._id || 'unknown'}`;
}

function userLink(user) {
  const id = user?.userId;
  const name = escHtml(userName(user));

  if (!id) return name;

  return `<a href="tg://user?id=${id}">${name}</a>`;
}

function groupLink(group) {
  const title = escHtml(group?.title || `Group ${group?.groupId || 'unknown'}`);
  const username = String(group?.username || '').replace(/^@/, '').trim();

  if (username) {
    return `<a href="https://t.me/${escHtml(username)}">${title}</a>`;
  }

  return title;
}

async function ownerOrReply(ctx, treasury = null, edit = false) {
  const t = treasury || await ensureTreasury();

  if (isOwner(ctx, t)) return t;

  const text =
    `⛔ <b>Owner only.</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Your ID: <code>${ctx.from?.id || 'unknown'}</code>\n` +
    `Owner ID: <code>${t?.ownerUserId || 'not_set'}</code>`;

  if (edit) await editHTML(ctx, text);
  else await replyHTML(ctx, text, replyOptions(ctx));

  return null;
}

async function statusText() {
  const t = await ensureTreasury();

  const [db, userCount, groupCount, vipCount] = await Promise.all([
    pingMs(),
    userModel.collection().countDocuments(),
    groupModel.collection().countDocuments(),
    userModel.collection().countDocuments({ isVip: true }),
  ]);

  const mem = process.memoryUsage();

  return (
    `📊 <b>BIKA Bot Status</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `🗄 DB: <b>${db == null ? 'N/A' : `${db} ms`}</b>\n` +
    `⏱ Uptime: <b>${uptime(process.uptime())}</b>\n` +
    `💾 Memory: <b>${Math.round(mem.rss / 1024 / 1024)} MB</b> RSS\n` +
    `🕒 Yangon: <b>${formatYangon(new Date())}</b>\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `👥 Users: <b>${fmt(userCount)}</b>\n` +
    `👥 Groups: <b>${fmt(groupCount)}</b>\n` +
    `🌟 VIP: <b>${fmt(vipCount)}</b>\n` +
    `🎲 Open Dice: <b>${fmt(activeDice.size)}</b>\n` +
    `🃏 Open Shan: <b>${fmt(activeShan.size)}</b>\n` +
    `🛠 Maintenance: <b>${t.maintenanceMode ? 'ON' : 'OFF'}</b>\n` +
    `🏦 Bot Bank: <b>${fmt(t.ownerBalance)}</b>`
  );
}

async function pingText() {
  const started = Date.now();
  const db = await pingMs();
  const botPing = Date.now() - started;

  return (
    `🏓 <b>Bot Ping</b>\n` +
    `━━━━━━━━━━━━\n` +
    `🤖 Bot Ping: <b>${fmt(botPing)} ms</b>\n` +
    `🗄 DB Ping: <b>${db == null ? 'N/A' : `${db} ms`}</b>`
  );
}

async function adminText() {
  const t = await ensureTreasury();

  const [userCount, groupCount, pendingCount, approvedCount, rejectedCount] = await Promise.all([
    userModel.collection().countDocuments(),
    groupModel.collection().countDocuments(),
    groupModel.collection().countDocuments({ approvalStatus: 'pending' }),
    groupModel.collection().countDocuments({ approvalStatus: 'approved' }),
    groupModel.collection().countDocuments({ approvalStatus: 'rejected' }),
  ]);

  return (
    `🛠 <b>Admin Dashboard</b>\n` +
    `━━━━━━━━━━━━\n` +
    `👥 Users: <b>${fmt(userCount)}</b>\n` +
    `👥 Groups: <b>${fmt(groupCount)}</b>\n` +
    `📝 Pending Requests: <b>${fmt(pendingCount)}</b>\n` +
    `✅ Approved Groups: <b>${fmt(approvedCount)}</b>\n` +
    `❌ Rejected Groups: <b>${fmt(rejectedCount)}</b>\n` +
    `🏦 Bot Bank: <b>${fmt(t.ownerBalance)}</b>\n` +
    `🛠 Maintenance: <b>${t.maintenanceMode ? 'ON' : 'OFF'}</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Choose an admin option below.`
  );
}

async function usersText(page) {
  const total = await userModel.collection().countDocuments();
  const users = await userModel.collection()
    .find({})
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .skip(page * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  const lines = users.map((user, index) => {
    const n = page * PAGE_SIZE + index + 1;
    const vip = user?.isVip ? ' 🌟' : '';
    return `${n}. ${userLink(user)}${vip}\n   ID: <code>${user?.userId || 'unknown'}</code> | Bal: <b>${fmt(user?.balance)}</b>`;
  });

  return (
    `👥 <b>User List</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Total: <b>${fmt(total)}</b>\n\n` +
    `${lines.length ? lines.join('\n') : 'No users found.'}`
  );
}

async function groupsText(page, filter = {}) {
  const total = await groupModel.collection().countDocuments(filter);
  const groups = await groupModel.collection()
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .skip(page * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  const lines = groups.map((group, index) => {
    const n = page * PAGE_SIZE + index + 1;
    const status = String(group?.approvalStatus || 'pending').toUpperCase();
    const admin = group?.botIsAdmin ? 'YES' : 'NO';

    return (
      `${n}. ${groupLink(group)}\n` +
      `   ID: <code>${group?.groupId || 'unknown'}</code>\n` +
      `   Status: <b>${escHtml(status)}</b> | Bot Admin: <b>${admin}</b>`
    );
  });

  return (
    `👥 <b>Group List</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Total: <b>${fmt(total)}</b>\n\n` +
    `${lines.length ? lines.join('\n') : 'No groups found.'}`
  );
}

async function requestsText(page) {
  const filter = { approvalStatus: 'pending' };
  const total = await groupModel.collection().countDocuments(filter);
  const groups = await groupModel.collection()
    .find(filter)
    .sort({ updatedAt: -1, createdAt: -1, _id: -1 })
    .skip(page * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .toArray();

  const lines = groups.map((group, index) => {
    const n = page * PAGE_SIZE + index + 1;
    const admin = group?.botIsAdmin ? 'YES' : 'NO';

    return (
      `${n}. ${groupLink(group)}\n` +
      `   ID: <code>${group?.groupId || 'unknown'}</code>\n` +
      `   Bot Admin: <b>${admin}</b>`
    );
  });

  const actionRows = groups.slice(0, 5).map((group, index) => {
    const title = String(group?.title || group?.groupId || 'Group').slice(0, 18);
    return [
      cbButton(`✅ ${index + 1}`, `ADMIN:APPROVE:${group.groupId}:${page}`, 'success'),
      cbButton(`❌ ${index + 1}`, `ADMIN:REJECT:${group.groupId}:${page}`, 'danger'),
      cbButton(title, `ADMIN:REQUESTS:${page}`, 'primary'),
    ];
  });

  return {
    text:
      `📝 <b>Group Approval Requests</b>\n` +
      `━━━━━━━━━━━━\n` +
      `Pending: <b>${fmt(total)}</b>\n\n` +
      `${lines.length ? lines.join('\n') : 'No pending requests.'}`,
    rows: actionRows,
    total,
  };
}

function bankText() {
  return (
    `🏦 <b>Bank Tools</b>\n` +
    `━━━━━━━━━━━━\n` +
    `Use these owner commands:\n\n` +
    `➕ Add balance:\n` +
    `<code>/addbal USER_ID AMOUNT</code>\n` +
    `or reply user + <code>/addbal AMOUNT</code>\n\n` +
    `➖ Remove balance:\n` +
    `<code>/rmbal USER_ID AMOUNT</code>\n` +
    `or reply user + <code>/rmbal AMOUNT</code>\n\n` +
    `💰 Treasury:\n` +
    `<code>/treasury</code>`
  );
}

async function renderHome(ctx, edit = false) {
  const text = await adminText();
  const extra = { reply_markup: adminKeyboard() };

  return edit ? editHTML(ctx, text, extra) : replyHTML(ctx, text, extra);
}

async function renderUsers(ctx, page) {
  const total = await userModel.collection().countDocuments();
  return editHTML(ctx, await usersText(page), {
    reply_markup: listNavKeyboard('USERS', page, total),
  });
}

async function renderGroups(ctx, page) {
  const total = await groupModel.collection().countDocuments();
  return editHTML(ctx, await groupsText(page), {
    reply_markup: listNavKeyboard('GROUPS', page, total),
  });
}

async function renderRequests(ctx, page) {
  const data = await requestsText(page);
  return editHTML(ctx, data.text, {
    reply_markup: listNavKeyboard('REQUESTS', page, data.total, data.rows),
  });
}

module.exports = (bot) => {
  bot.command('ping', async (ctx) => {
    return replyHTML(ctx, await pingText(), replyOptions(ctx));
  });

  bot.command('status', async (ctx) => {
    const t = await ownerOrReply(ctx);
    if (!t) return;

    return replyHTML(ctx, await statusText(), replyOptions(ctx));
  });

  bot.command('admin', async (ctx) => {
    const t = await ownerOrReply(ctx);
    if (!t) return;

    return renderHome(ctx, false);
  });

  bot.on('callback_query', async (ctx, next) => {
    const data = String(ctx.callbackQuery?.data || '');

    if (!data.startsWith('ADMIN:')) return next();

    const treasury = await ownerOrReply(ctx, null, true);
    if (!treasury) {
      try {
        await ctx.answerCbQuery('Owner only.', { show_alert: true });
      } catch (_) {}
      return;
    }

    const parts = data.split(':');
    const action = parts[1];

    try {
      await ctx.answerCbQuery();
    } catch (_) {}

    if (action === 'HOME') return renderHome(ctx, true);

    if (action === 'PING') {
      return editHTML(ctx, await pingText(), { reply_markup: backKeyboard() });
    }

    if (action === 'STATUS') {
      return editHTML(ctx, await statusText(), { reply_markup: backKeyboard() });
    }

    if (action === 'BANK') {
      return editHTML(ctx, bankText(), { reply_markup: backKeyboard() });
    }

    if (action === 'USERS') {
      const page = Math.max(0, Number(parts[2]) || 0);
      return renderUsers(ctx, page);
    }

    if (action === 'GROUPS') {
      const page = Math.max(0, Number(parts[2]) || 0);
      return renderGroups(ctx, page);
    }

    if (action === 'REQUESTS') {
      const page = Math.max(0, Number(parts[2]) || 0);
      return renderRequests(ctx, page);
    }

    if (action === 'APPROVE' || action === 'REJECT') {
      const groupId = Number(parts[2]);
      const page = Math.max(0, Number(parts[3]) || 0);

      if (!Number.isFinite(groupId)) {
        return editHTML(ctx, '⚠️ Invalid group id.', { reply_markup: backKeyboard() });
      }

      const status = action === 'APPROVE' ? 'approved' : 'rejected';
      const set = {
        approvalStatus: status,
        updatedAt: new Date(),
      };

      if (action === 'APPROVE') {
        set.approvedAt = new Date();
        set.approvedBy = ctx.from.id;
      } else {
        set.rejectedAt = new Date();
        set.rejectedBy = ctx.from.id;
      }

      await groupModel.collection().updateOne({ groupId }, { $set: set });

      try {
        await ctx.answerCbQuery(
          action === 'APPROVE' ? 'Group approved.' : 'Group rejected.',
          { show_alert: false }
        );
      } catch (_) {}

      return renderRequests(ctx, page);
    }

    return next();
  });
};
