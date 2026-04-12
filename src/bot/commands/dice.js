module.exports = function registerDice(bot) {
  bot.command('dice', async (ctx) => {
    // Telegraf supports sending dice emojis which Telegram interprets
    return ctx.replyWithDice('🎲');
  });
};