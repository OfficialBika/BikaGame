module.exports = function registerGroupCommands(bot, { groupService }, config) {
  // Show list of pending groups (owner only)
  bot.command('pendinggroups', async (ctx) => {
    if (ctx.from?.id !== config.ownerId) return ctx.reply('Not authorized.');
    const pending = await groupService.getPending(20);
    if (!pending.length) return ctx.reply('No pending groups.');
    let text = '<b>Pending Groups</b>\n\n';
    pending.forEach((g, idx) => {
      text += `${idx + 1}. ${g.title || g.groupId} (ID: ${g.groupId})\n`;
    });
    return ctx.reply(text, { parse_mode: 'HTML' });
  });

  // Check group status for the current chat
  bot.command('groupstatus', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) {
      return ctx.reply('This command can only be used in groups.');
    }
    const group = await groupService.ensureGroup(chat);
    await ctx.reply(`Group ${chat.title}: ${group.approvalStatus}`);
  });

  // Approve a group by ID (owner only)
  bot.command('approve', async (ctx) => {
    if (ctx.from?.id !== config.ownerId) return ctx.reply('Not authorized.');
    const parts = ctx.message.text.trim().split(/\s+/);
    const id = Number(parts[1]);
    if (!id) return ctx.reply('Usage: /approve <groupId>');
    const group = await groupService.setStatus(id, 'approved');
    if (!group) return ctx.reply('Group not found.');
    await ctx.reply(`Approved group ${group.title || group.groupId}`);
  });

  // Reject a group by ID (owner only)
  bot.command('reject', async (ctx) => {
    if (ctx.from?.id !== config.ownerId) return ctx.reply('Not authorized.');
    const parts = ctx.message.text.trim().split(/\s+/);
    const id = Number(parts[1]);
    if (!id) return ctx.reply('Usage: /reject <groupId>');
    const group = await groupService.setStatus(id, 'rejected');
    if (!group) return ctx.reply('Group not found.');
    await ctx.reply(`Rejected group ${group.title || group.groupId}`);
  });
};