module.exports = function registerStart(bot, { userService }, config) {
  bot.start(async (ctx) => {
    const tgUser = ctx.from;
    if (!tgUser) return;
    // Ensure user and award start bonus if they are new
    const user = await userService.ensureUser(tgUser, config.startBonus);
    const welcome = `Welcome, ${tgUser.first_name || 'Player'}! You now have ${config.coin} ${user.balance}. Enjoy the game!`;
    await ctx.reply(welcome);
  });
};