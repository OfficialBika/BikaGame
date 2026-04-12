const { fmt } = require('../../utils/format');

module.exports = function registerStatus(bot, { userService, groupService, db }, config) {
  bot.command('status', async (ctx) => {
    // Only owner can run
    if (ctx.from?.id !== config.ownerId) {
      return ctx.reply('You are not authorized to view status.');
    }
    const usersCount = await db.collection('users').countDocuments();
    const groupsCount = await db.collection('groups').countDocuments();
    // Sum of balances (supply) - note: may not scale for large DB; use aggregation.
    const agg = await db.collection('users').aggregate([
      { $group: { _id: null, total: { $sum: '$balance' } } },
    ]).toArray();
    const totalSupply = agg[0]?.total || 0;
    const text = `<b>Bot Status</b>\n\nUsers: ${usersCount}\nGroups: ${groupsCount}\nTotal Supply: ${fmt(totalSupply)} ${config.coin}`;
    await ctx.reply(text, { parse_mode: 'HTML' });
  });
};