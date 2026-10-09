'use strict';

// Opt-in edit pipeline. Disabled by default so existing production behavior is unchanged.
const ENABLED = String(process.env.TELEGRAM_EDIT_QUEUE_ENABLED || '').toLowerCase() === 'true';
const MAX_CONCURRENT = Math.max(1, Math.min(20, Number(process.env.TELEGRAM_EDIT_MAX_CONCURRENT || 5)));
const perMessage = new Map();
const trackedMessages = new Map();
const waiters = [];
let active = 0;

function acquire() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve)).then(() => {
    active += 1;
  });
}

function release() {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

function messageKey(chatId, messageId) {
  return `${String(chatId)}:${String(messageId)}`;
}

function trackMessage(chatId, messageId, metadata = {}) {
  if (chatId == null || messageId == null) return null;
  const key = messageKey(chatId, messageId);
  const record = {
    chatId: String(chatId),
    messageId: Number(messageId),
    kind: metadata.kind || 'message',
    updatedAt: new Date().toISOString(),
  };
  trackedMessages.set(key, record);
  return record;
}

function getTrackedMessage(chatId, messageId) {
  return trackedMessages.get(messageKey(chatId, messageId)) || null;
}

function listTrackedMessages() {
  return [...trackedMessages.values()];
}

async function runWithLimit(task) {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

function enqueueMessageEdit(chatId, messageId, task, metadata = {}) {
  if (!ENABLED) return Promise.resolve().then(task);
  const key = messageKey(chatId, messageId);
  const previous = perMessage.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(() => runWithLimit(task));
  perMessage.set(key, current);
  current.then(
    () => { if (perMessage.get(key) === current) perMessage.delete(key); },
    () => { if (perMessage.get(key) === current) perMessage.delete(key); }
  );
  trackMessage(chatId, messageId, metadata);
  return current;
}

module.exports = {
  ENABLED,
  MAX_CONCURRENT,
  enqueueMessageEdit,
  trackMessage,
  getTrackedMessage,
  listTrackedMessages,
};
