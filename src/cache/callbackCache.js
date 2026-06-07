'use strict';

/**
 * Per-key async lock.
 *
 * This prevents double-click/double-spend for the same callback key only.
 * It does NOT globally serialize all bot updates, so different users and
 * different games can run at the same time.
 */

const locks = new Map();

const DEFAULT_LOCK_TTL_MS = Number(process.env.CALLBACK_LOCK_TTL_MS || 30_000);
const MAX_LOCKS = Number(process.env.CALLBACK_LOCK_MAX || 20_000);

function nowMs() {
  return Date.now();
}

function cleanupExpiredLocks() {
  const now = nowMs();

  for (const [key, item] of locks.entries()) {
    if (item.expiresAt <= now) {
      locks.delete(key);
    }
  }

  if (locks.size > MAX_LOCKS) {
    const deleteCount = Math.ceil(locks.size * 0.20);
    let deleted = 0;

    for (const key of locks.keys()) {
      locks.delete(key);
      deleted += 1;
      if (deleted >= deleteCount) break;
    }
  }
}

function isLocked(key) {
  cleanupExpiredLocks();

  const lockKey = String(key);
  const item = locks.get(lockKey);

  if (!item) return false;

  if (item.expiresAt <= nowMs()) {
    locks.delete(lockKey);
    return false;
  }

  return true;
}

async function withLock(key, fn, options = {}) {
  if (typeof fn !== 'function') {
    throw new TypeError('withLock requires a function');
  }

  const lockKey = String(key || 'default');
  const ttlMs = Number(options.ttlMs || DEFAULT_LOCK_TTL_MS);

  cleanupExpiredLocks();

  if (isLocked(lockKey)) {
    return false;
  }

  locks.set(lockKey, {
    createdAt: nowMs(),
    expiresAt: nowMs() + Math.max(1000, ttlMs),
  });

  try {
    return await fn();
  } finally {
    locks.delete(lockKey);
  }
}

function getLockStats() {
  cleanupExpiredLocks();

  return {
    active: locks.size,
    max: MAX_LOCKS,
    ttlMs: DEFAULT_LOCK_TTL_MS,
  };
}

module.exports = {
  withLock,
  isLocked,
  getLockStats,
};
