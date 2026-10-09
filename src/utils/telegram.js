'use strict';

const logger = require('./logger');
const editQueue = require('./telegramEditQueue');

function getRetryAfterSec(err) {
  const retry = err?.response?.parameters?.retry_after;
  const m = String(err?.message || err);
  const match = m.match(/retry after (\\d+)/i);
  return typeof retry === 'number' ? retry : (match ? Number(match[1]) || 0 : 0);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeTelegram(fn, { maxRetries = 2, maxRetryAfterSec = 5 } = {}) {
  let last;
  for (let i = 0; i < maxRetries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const retry = getRetryAfterSec(err);
      if (String(err?.message || err).includes('429') || retry > 0) {
        const capped = Math.min(Math.max(1, retry || 2), Math.max(1, Number(maxRetryAfterSec) || 5));
        await sleep(capped * 1000 + Math.floor(Math.random() * 250));
        continue;
      }
      break;
    }
  }
  throw last;
}

// Queue-only retries honor Telegram's retry_after value. This path is opt-in with
// TELEGRAM_EDIT_QUEUE_ENABLED=true; the legacy send/reply path stays unchanged.
async function safeQueuedEdit(fn) {
  let last;
  const attempts = Math.max(1, Math.min(5, Number(process.env.TELEGRAM_EDIT_RETRIES || 3)));
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const retry = getRetryAfterSec(err);
      const message = String(err?.message || err);
      if (message.includes('message is not modified')) return null;
      if (!(message.includes('429') || retry > 0) || i === attempts - 1) break;
      await sleep(Math.max(1, retry || 2) * 1000 + Math.floor(Math.random() * 250));
    }
  }
  throw last;
}

async function replyHTML(ctx, html, extra = {}) {
  try {
    return await safeTelegram(() => ctx.reply(html, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    }));
  } catch (err) {
    logger.warn('replyHTML fallback', err.message);
    try {
      return await ctx.reply(String(html).replace(/<[^>]+>/g, ''), extra);
    } catch (_) {
      return null;
    }
  }
}

async function editHTML(ctx, html, extra = {}) {
  const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id;
  const messageId = ctx.callbackQuery?.message?.message_id ?? ctx.message?.message_id;
  const operation = () => safeQueuedEdit(() => ctx.editMessageText(html, {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  }));
  try {
    const result = chatId != null && messageId != null
      ? await editQueue.enqueueMessageEdit(chatId, messageId, operation, { kind: 'text' })
      : await operation();
    if (result && chatId != null && messageId != null) editQueue.trackMessage(chatId, messageId, { kind: 'text' });
    return result;
  } catch (err) {
    const message = String(err?.message || err);
    if (!message.includes('message is not modified')) logger.warn('editHTML', message);
    return null;
  }
}

async function editByIds(bot, chatId, messageId, html, extra = {}) {
  const operation = () => safeQueuedEdit(() => bot.telegram.editMessageText(
    chatId, messageId, undefined, html,
    { parse_mode: 'HTML', disable_web_page_preview: true, ...extra }
  ));
  try {
    const result = await editQueue.enqueueMessageEdit(chatId, messageId, operation, { kind: 'text' });
    if (result) editQueue.trackMessage(chatId, messageId, { kind: 'text' });
    return result;
  } catch (err) {
    const message = String(err?.message || err);
    if (!message.includes('message is not modified')) logger.warn('editByIds', message);
    return null;
  }
}

async function editMarkupByIds(bot, chatId, messageId, replyMarkup, extra = {}) {
  const operation = () => safeQueuedEdit(() => bot.telegram.editMessageReplyMarkup(
    chatId, messageId, undefined, replyMarkup, extra
  ));
  try {
    const result = await editQueue.enqueueMessageEdit(chatId, messageId, operation, { kind: 'keyboard' });
    if (result) editQueue.trackMessage(chatId, messageId, { kind: 'keyboard' });
    return result;
  } catch (err) {
    const message = String(err?.message || err);
    if (!message.includes('message is not modified')) logger.warn('editMarkupByIds', message);
    return null;
  }
}

async function editMediaByIds(bot, chatId, messageId, media, extra = {}) {
  const operation = () => safeQueuedEdit(() => bot.telegram.editMessageMedia(
    chatId, messageId, undefined, media, extra
  ));
  try {
    const result = await editQueue.enqueueMessageEdit(chatId, messageId, operation, { kind: 'media' });
    if (result) editQueue.trackMessage(chatId, messageId, { kind: 'media' });
    return result;
  } catch (err) {
    const message = String(err?.message || err);
    if (!message.includes('message is not modified')) logger.warn('editMediaByIds', message);
    return null;
  }
}

module.exports = {
  safeTelegram,
  replyHTML,
  editHTML,
  editByIds,
  editMarkupByIds,
  editMediaByIds,
  getRetryAfterSec,
  trackMessage: editQueue.trackMessage,
  getTrackedMessage: editQueue.getTrackedMessage,
  listTrackedMessages: editQueue.listTrackedMessages,
};
