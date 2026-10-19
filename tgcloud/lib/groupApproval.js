import { api, db, EndpointError } from 'sdk';
import { eq } from 'sdk/db';
import { groups } from '../schema.js';
import { SERVERLESS_OWNER_TELEGRAM_ID } from './config.js';
import {
  groupAccessDecision,
  isBotAdministratorStatus,
  isConfiguredOwner,
  isFreshBotAdminCheck,
  isGroupChat,
} from './groupApprovalPolicy.js';

const now = () => new Date();

function ownerId() {
  const id = Number(SERVERLESS_OWNER_TELEGRAM_ID);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export async function getGroup(groupId) {
  const id = Number(groupId);
  if (!Number.isSafeInteger(id) || id >= 0) {
    throw new EndpointError('Invalid Telegram group ID.', { code: 'GROUP_ID_INVALID' });
  }
  return db.select().from(groups).where(eq(groups.groupId, id)).get();
}

export async function ensureGroup(chat) {
  if (!isGroupChat(chat)) return null;
  const groupId = Number(chat.id);
  if (!Number.isSafeInteger(groupId) || groupId >= 0) {
    throw new EndpointError('Only Telegram group chats can be registered.', { code: 'GROUP_ID_INVALID' });
  }

  const timestamp = now();
  const prior = await db.select().from(groups).where(eq(groups.groupId, groupId)).get();
  if (!prior) {
    await db.insert(groups).values({
      groupId,
      title: String(chat.title || 'Untitled Group').slice(0, 256),
      username: chat.username ? String(chat.username).replace(/^@/, '').toLowerCase().slice(0, 64) : null,
      type: String(chat.type),
      approvalStatus: 'pending',
      botIsAdmin: false,
      inviteLink: null,
      data: { createdBy: 'group_approval_middleware' },
      createdAt: timestamp,
      updatedAt: timestamp,
    }).onConflictDoNothing().run();
  } else {
    await db.update(groups).set({
      title: String(chat.title || prior.title || 'Untitled Group').slice(0, 256),
      username: chat.username ? String(chat.username).replace(/^@/, '').toLowerCase().slice(0, 64) : prior.username,
      type: String(chat.type),
      updatedAt: timestamp,
    }).where(eq(groups.groupId, groupId)).run();
  }
  return db.select().from(groups).where(eq(groups.groupId, groupId)).get();
}

export async function refreshBotAdminStatus(chat) {
  const group = await ensureGroup(chat);
  if (!group) return { ok: false, botIsAdmin: false, status: 'not_a_group', group: null };

  try {
    const bot = await api.getMe();
    const member = await api.getChatMember({
      chat_id: Number(chat.id),
      user_id: Number(bot?.id),
    });
    const status = String(member?.status || 'unknown');
    const botIsAdmin = isBotAdministratorStatus(status);
    await db.update(groups).set({
      botIsAdmin,
      updatedAt: now(),
      data: {
        ...(group.data && typeof group.data === 'object' && !Array.isArray(group.data) ? group.data : {}),
        botAdminStatus: status,
        botAdminCheckedAt: now().toISOString(),
      },
    }).where(eq(groups.groupId, Number(chat.id))).run();
    return {
      ok: true,
      botIsAdmin,
      status,
      group: await getGroup(Number(chat.id)),
    };
  } catch (error) {
    console.warn('Group approval bot-admin verification failed:', String(error?.message || error));
    return {
      ok: false,
      botIsAdmin: false,
      status: 'unknown',
      error: String(error?.message || error),
      group: await getGroup(Number(chat.id)),
    };
  }
}

export async function checkGroupAccess(chat, actorUserId) {
  if (!isGroupChat(chat)) return { allowed: true, reason: 'private', group: null };
  const configuredOwner = ownerId();
  const group = await ensureGroup(chat);

  // Owner recovery commands must remain usable if the bot loses admin rights.
  if (isConfiguredOwner(actorUserId, configuredOwner)) {
    return { ...groupAccessDecision(group, actorUserId, configuredOwner), group };
  }

  let checked = { ok: true, botIsAdmin: Boolean(group?.botIsAdmin), group };
  if (!isFreshBotAdminCheck(group)) {
    checked = await refreshBotAdminStatus(chat);
  }
  if (!checked.ok) {
    return { allowed: false, reason: 'admin_unverified', group: checked.group || group };
  }

  const freshGroup = checked.group || group;
  const decision = groupAccessDecision(freshGroup, actorUserId, configuredOwner);
  return { ...decision, group: freshGroup };
}

function requireOwner(actorUserId) {
  const configured = ownerId();
  if (!configured) {
    throw new EndpointError('SERVERLESS_OWNER_TELEGRAM_ID is not configured; approval is disabled.', {
      code: 'OWNER_NOT_CONFIGURED',
    });
  }
  if (!isConfiguredOwner(actorUserId, configured)) {
    throw new EndpointError('Only the configured owner may approve or reject groups.', {
      code: 'OWNER_ONLY',
    });
  }
}

export async function approveCurrentGroup(chat, actorUserId) {
  if (!isGroupChat(chat)) throw new EndpointError('Use /approve inside the target group.', { code: 'GROUP_ONLY' });
  requireOwner(actorUserId);
  const admin = await refreshBotAdminStatus(chat);
  if (!admin.ok || !admin.botIsAdmin) {
    throw new EndpointError('Bot administrator status could not be verified. Promote the bot to admin and retry.', {
      code: 'BOT_ADMIN_REQUIRED',
      status: admin.status,
    });
  }
  const timestamp = now();
  const group = admin.group || await ensureGroup(chat);
  await db.update(groups).set({
    approvalStatus: 'approved',
    updatedAt: timestamp,
    data: {
      ...(group?.data && typeof group.data === 'object' && !Array.isArray(group.data) ? group.data : {}),
      approval: { action: 'approved', actorUserId: Number(actorUserId), at: timestamp.toISOString() },
    },
  }).where(eq(groups.groupId, Number(chat.id))).run();
  return getGroup(Number(chat.id));
}

export async function rejectCurrentGroup(chat, actorUserId) {
  if (!isGroupChat(chat)) throw new EndpointError('Use /reject inside the target group.', { code: 'GROUP_ONLY' });
  requireOwner(actorUserId);
  const group = await ensureGroup(chat);
  const timestamp = now();
  await db.update(groups).set({
    approvalStatus: 'rejected',
    updatedAt: timestamp,
    data: {
      ...(group?.data && typeof group.data === 'object' && !Array.isArray(group.data) ? group.data : {}),
      approval: { action: 'rejected', actorUserId: Number(actorUserId), at: timestamp.toISOString() },
    },
  }).where(eq(groups.groupId, Number(chat.id))).run();
  return getGroup(Number(chat.id));
}

export async function getGroupStatus(chat) {
  if (!isGroupChat(chat)) throw new EndpointError('Use /groupstatus inside a group.', { code: 'GROUP_ONLY' });
  const admin = await refreshBotAdminStatus(chat);
  const group = admin.group || await ensureGroup(chat);
  return {
    group,
    botAdminCheckSucceeded: admin.ok,
    botIsAdmin: Boolean(admin.botIsAdmin),
    botAdminStatus: admin.status,
    ownerConfigured: ownerId() > 0,
  };
}

export function groupAccessMessage(reason) {
  if (reason === 'admin_unverified') {
    return '⚠️ Bot admin status ကို Telegram မှာ အတည်မပြုနိုင်သေးပါ။ ခဏနေပြီး ပြန်စမ်းပါ။';
  }
  if (reason === 'admin_required') {
    return '⚠️ Bot ကို group admin ပေးပြီး Owner က /approve ပေးမှ အသုံးပြုနိုင်ပါမယ်။';
  }
  if (reason === 'rejected') {
    return '⛔ ဒီ group ကို Owner က reject လုပ်ထားပါတယ်။';
  }
  return '⛔ ဒီ group ကို Owner က /approve ပေးမှ အသုံးပြုနိုင်ပါမယ်။';
}
