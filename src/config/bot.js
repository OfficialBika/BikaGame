const { Telegraf } = require('telegraf');
const { env } = require('./env');
const bot = new Telegraf(env.BOT_TOKEN);
let botInfo = null;
async function initBotInfo() { botInfo = await bot.telegram.getMe(); return botInfo; }
function getBotInfo() { return botInfo; }
module.exports = { bot, initBotInfo, getBotInfo };
