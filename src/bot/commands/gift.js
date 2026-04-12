const { toNum, fmt } = require('../../utils/format');

function parseArgs(text) {
  // Splits command text by whitespace and returns arguments after command.
  const parts = (text || '').trim().split(/\s+/);
  // Remove the command part (e.g. '/gift')
  return parts.slice(1);
}

module.exports = function registerGift(bot, { userService }, config) {
  bot.command('gift', async (ctx) => {
    const tgUser = ctx.from;
    const args = parseArgs(ctx.message?.text);
    // Determine recipient
    let recipientTgId = null;
    let usernameArg = null;
    let amountArg = null;
    for (const arg of args) {
      if (arg.startsWith('@')) {
        usernameArg = arg.slice(1);
      } else if (/^\d+(?:\.\d+)?$/.test(arg.replace(/,/g, ''))) {
        amountArg = arg;
      }
    }
    // If command is a reply
    if (!usernameArg && ctx.message?.reply_to_message) {
      recipientTgId = ctx.message.reply_to_message.from?.id;
    }
    let recipient;
    if (recipientTgId) {
      recipient = await userService.getUserById(recipientTgId);
    } else if (usernameArg) {
      recipient = await userService.getUserByUsername(usernameArg);
    }
    if (!recipient) {
      await ctx.reply('Please mention a valid recipient (reply or @username).');
      return;
    }
    const amount = toNum(amountArg);
    if (!amount || amount <= 0) {
      await ctx.reply('Please specify a valid amount to gift.');
      return;
    }
    const result = await userService.transferBalance(tgUser.id, recipient.userId, amount);
    if (!result.ok) {
      await ctx.reply(result.msg || 'Transfer failed.');
      return;
    }
    await ctx.reply(`Gifted ${config.coin} ${fmt(amount)} to ${recipient.username || recipient.userId}!`);
  });
};