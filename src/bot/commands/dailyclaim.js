module.exports = function registerDailyClaim(bot, { userService }, config) {
  bot.command(['dailyclaim', 'daily'], async (ctx) => {
    const tgUser = ctx.from;
    await userService.ensureUser(tgUser, config.startBonus);
    const res = await userService.dailyClaim(tgUser.id, 500, 2000, config.timeZone);
    if (!res.ok) {
      await ctx.reply(res.msg || 'Unable to claim daily reward.');
      return;
    }
    await ctx.reply(`You claimed ${config.coin} ${res.amount} as your daily reward!`);
  });
};