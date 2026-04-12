const { fmt } = require('../../utils/format');
const { mentionHtml } = require('../../utils/html');

module.exports = function registerTop(bot, { userService }, config) {
  bot.command(['top10', 'top'], async (ctx) => {
    const list = await userService.topUsers(10);
    if (!list.length) {
      await ctx.reply('No users found.');
      return;
    }
    let text = '<b>Top Users</b>\n\n';
    list.forEach((u, idx) => {
      const name = u.username ? '@' + u.username : (u.firstName || 'User');
      text += `${idx + 1}. ${name} — ${fmt(u.balance)} ${config.coin}\n`;
    });
    await ctx.reply(text, { parse_mode: 'HTML' });
  });
};