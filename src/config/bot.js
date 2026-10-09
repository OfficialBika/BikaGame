const { Telegraf } = require('telegraf');
const { env } = require('./env');

// Keep Telegram's official API as the default. For a Local Bot API server,
// set TELEGRAM_API_ROOT (for example http://127.0.0.1:8081) on the bot host.
const bot = new Telegraf(env.BOT_TOKEN, {
  telegram: {
    apiRoot: env.TELEGRAM_API_ROOT,
  },
});
let botInfo = null;
async function initBotInfo() { botInfo = await bot.telegram.getMe(); return botInfo; }
function getBotInfo() { return botInfo; }
module.exports = { bot, initBotInfo, getBotInfo };
