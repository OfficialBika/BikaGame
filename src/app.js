const express = require('express');
const { Telegraf } = require('telegraf');
const config = require('./config/env');
const { connect } = require('./db/mongo');

// Services
const userService = require('./services/userService');
const groupService = require('./services/groupService');

// Commands
const registerStart = require('./bot/commands/start');
const registerPing = require('./bot/commands/ping');
const registerBalance = require('./bot/commands/balance');
const registerDailyClaim = require('./bot/commands/dailyclaim');
const registerGift = require('./bot/commands/gift');
const registerTop = require('./bot/commands/top');
const registerStatus = require('./bot/commands/status');
const registerGroupCommands = require('./bot/commands/group');
const registerSlot = require('./bot/commands/slot');
const registerDice = require('./bot/commands/dice');

async function main() {
  // Connect to MongoDB
  const { db, users, groups } = await connect({ uri: config.mongoUri, dbName: config.dbName });
  // Initialize services with collections
  userService.init({ users });
  groupService.init({ groups });
  // Create bot
  const bot = new Telegraf(config.botToken);
  // Register commands
  registerStart(bot, { userService }, config);
  registerPing(bot);
  registerBalance(bot, { userService }, config);
  registerDailyClaim(bot, { userService }, config);
  registerGift(bot, { userService }, config);
  registerTop(bot, { userService }, config);
  registerStatus(bot, { userService, groupService, db }, config);
  registerGroupCommands(bot, { groupService }, config);
  registerSlot(bot, { userService }, config);
  registerDice(bot);
  // Additional handlers: handle group joins to ensure group exists
  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== 'group' && chat.type !== 'supergroup')) return;
    await groupService.ensureGroup(chat);
  });
  // Start bot using webhook or polling
  if (config.useWebhook) {
    const app = express();
    app.use(express.json());
    app.post(`/webhook/${config.webhookSecret}`, (req, res) => {
      bot.handleUpdate(req.body);
      res.status(200).send('ok');
    });
    app.get('/', (_, res) => res.send('Bika Game Bot is running'));
    // Set webhook
    await bot.telegram.setWebhook(`${config.publicUrl}/webhook/${config.webhookSecret}`);
    // Express listens on configured port
    const port = config.port;
    app.listen(port, () => {
      console.log(`Server listening on port ${port}`);
    });
  } else {
    await bot.launch();
    console.log('Bot started using long polling');
  }
  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});