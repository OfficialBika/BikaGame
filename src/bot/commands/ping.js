module.exports = function registerPing(bot) {
  bot.command('ping', async (ctx) => {
    const started = Date.now();
    const msg = await ctx.reply('Pong!');
    const ms = Date.now() - started;
    // Edit message to include latency
    await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `Pong! Latency: ${ms}ms`);
  });
};