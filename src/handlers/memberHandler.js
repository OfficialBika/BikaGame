'use strict';

const { setBotAdmin, ensureGroup } = require('../services/groupService');

function isGroupChat(chat) {
  return chat?.type === 'group' || chat?.type === 'supergroup';
}

function isAdminStatus(status) {
  return status === 'administrator' || status === 'creator';
}

module.exports = (bot) => {
  bot.on('my_chat_member', async (ctx, next) => {
    const update = ctx.update?.my_chat_member;
    const chat = update?.chat;

    if (!isGroupChat(chat)) {
      return next();
    }

    try {
      await ensureGroup(chat);

      const status = update?.new_chat_member?.status;
      const botIsAdmin = isAdminStatus(status);

      await setBotAdmin(chat.id, botIsAdmin);
    } catch (err) {
      console.error('memberHandler my_chat_member', err?.message || err);
    }

    return next();
  });

  bot.on('chat_member', async (ctx, next) => {
    const update = ctx.update?.chat_member;
    const chat = update?.chat;

    if (!isGroupChat(chat)) {
      return next();
    }

    try {
      await ensureGroup(chat);
    } catch (err) {
      console.error('memberHandler chat_member', err?.message || err);
    }

    return next();
  });
};
