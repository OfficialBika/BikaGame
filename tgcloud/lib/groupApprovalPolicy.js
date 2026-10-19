export const GROUP_TYPES = Object.freeze(['group', 'supergroup']);

export function isGroupChat(chat) {
  return GROUP_TYPES.includes(String(chat?.type || '').toLowerCase());
}

export function isBotAdministratorStatus(status) {
  return status === 'administrator' || status === 'creator';
}

export function isConfiguredOwner(actorUserId, ownerUserId) {
  const owner = Number(ownerUserId);
  const actor = Number(actorUserId);
  return Number.isSafeInteger(owner) && owner > 0 &&
    Number.isSafeInteger(actor) && actor > 0 && actor === owner;
}

export function isFreshBotAdminCheck(group, nowMs = Date.now(), maxAgeMs = 60000) {
  const checkedAt = Date.parse(String(group?.data?.botAdminCheckedAt || ''));
  return Number.isFinite(checkedAt) && checkedAt <= nowMs && nowMs - checkedAt < maxAgeMs;
}

export function groupAccessDecision(group, actorUserId, ownerUserId) {
  if (isConfiguredOwner(actorUserId, ownerUserId)) {
    return { allowed: true, reason: 'owner' };
  }
  // Approval is not sufficient if the bot is no longer an administrator.
  if (!group?.botIsAdmin) {
    return { allowed: false, reason: 'admin_required' };
  }
  if (group?.approvalStatus === 'approved') {
    return { allowed: true, reason: 'approved' };
  }
  return { allowed: false, reason: group?.approvalStatus === 'rejected' ? 'rejected' : 'pending' };
}
