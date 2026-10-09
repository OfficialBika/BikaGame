'use strict';

const logger = require('./logger');

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

const MAX_CONCURRENT = boundedInteger(process.env.SLOT_EDIT_MAX_CONCURRENT, 5, 1, 20);
const MAX_RETRIES = boundedInteger(process.env.SLOT_EDIT_RETRIES, 3, 1, 5);
const perMessage = new Map();
const waiters = [];
let active = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterSec(err) {
  const retry = err?.response?.parameters?.retry_after;
  const message = String(err?.message || err);
  const match = message.match(/retry after (\d+)/i);
  if (typeof retry === 'number' && Number.isFinite(retry)) return retry;
  return match ? Number(match[1]) || 0 : 0;
}

async function safeEdit(task) {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      return await task();
    } catch (err) {
      lastError = err;
      const message = String(err?.message || err);
      if (message.includes('message is not modified')) return null;

      const retryAfter = getRetryAfterSec(err);
      const rateLimited =
        Number(err?.response?.error_code) === 429 ||
        message.includes('429') ||
        retryAfter > 0;

      if (!rateLimited || attempt === MAX_RETRIES - 1) break;
      await sleep(Math.max(1, retryAfter || 2) * 1000 + Math.floor(Math.random() * 250));
    }
  }
  throw lastError;
}

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

async function runWithLimit(task) {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

function enqueueMessageEdit(chatId, messageId, task) {
  const key = `${String(chatId)}:${String(messageId)}`;
  const previous = perMessage.get(key) || Promise.resolve();
  const current = previous.catch(() => undefined).then(() => runWithLimit(task));
  perMessage.set(key, current);

  const cleanup = () => {
    if (perMessage.get(key) === current) perMessage.delete(key);
  };
  current.then(cleanup, cleanup);
  return current;
}

async function editSlotByIds(bot, chatId, messageId, html, extra = {}) {
  const operation = () => safeEdit(() => bot.telegram.editMessageText(
    chatId,
    messageId,
    undefined,
    html,
    { parse_mode: 'HTML', disable_web_page_preview: true, ...extra }
  ));

  try {
    return await enqueueMessageEdit(chatId, messageId, operation);
  } catch (err) {
    const message = String(err?.message || err);
    if (!message.includes('message is not modified')) logger.warn('editSlotByIds', message);
    return null;
  }
}

module.exports = {
  editSlotByIds,
  MAX_CONCURRENT,
  MAX_RETRIES,
};
