'use strict';

const { ensureUser } = require('../services/economyService');
const { ensureGroup } = require('../services/groupService');

/**
 * Fast user/group checker with TTL cache.
 *
 * Old version called ensureUser() and ensureGroup() on every update.
 * That makes simple commands like /bal, .bal, /dailyclaim slow because every
 * message performs MongoDB writes before reaching the command handler.
 */

const userSeenAt = new Map();
const groupSeenAt = new Map();

const USER_TTL_MS = Number(process.env.USER_CHECK_TTL_MS || 60_000);
const GROUP_TTL_MS = Number(process.env.GROUP_CHECK_TTL_MS || 300_000);
const MAX_CACHE_SIZE = Number(process.env.USER_CHECK_MAX_CACHE || 20_000);

function shouldRefresh(cache, key, ttlMs) {
  if (key == null) return false;

  const keyString = String(key);
  const now = Date.now();
  const last = cache.get(keyString) || 0;

  if (now - last < ttlMs) return false;

  cache.set(keyString, now);

  // Small memory protection for long-running bots.
  if (cache.size > MAX_CACHE_SIZE) {
    const deleteCount = Math.ceil(cache.size * 0.20);
    let deleted = 0;

    for (const oldKey of cache.keys()) {
      cache.delete(oldKey);
      deleted += 1;
      if (deleted >= deleteCount) break;
    }
  }

  return true;
}

function isGroupChat(chat) {
  return chat?.type === 'group' || chat?.type === 'supergroup';
}

module.exports = async (ctx, next) => {
  try {
    const userId = ctx.from?.id;

    if (userId && shouldRefresh(userSeenAt, userId, USER_TTL_MS)) {
      await ensureUser(ctx.from);
    }

    if (
      isGroupChat(ctx.chat) &&
      ctx.chat?.id &&
      shouldRefresh(groupSeenAt, ctx.chat.id, GROUP_TTL_MS)
    ) {
      await ensureGroup(ctx.chat);
    }
  } catch (err) {
    console.error('userCheck', err?.message || err);
  }

  return next();
};
