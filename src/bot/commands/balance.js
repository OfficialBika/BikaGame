module.exports = function registerBalance(bot, { userService }, config) {
  bot.command(['balance', 'bal'], async (ctx) => {
    const tgUser = ctx.from;
    const user = await userService.ensureUser(tgUser, config.startBonus);
    await ctx.reply(`Your balance: ${config.coin} ${user.balance}`);
  });
};