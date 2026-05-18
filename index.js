require('dotenv').config();
const express = require('express');
const { bot, initBotInfo, getBotInfo } = require('./src/config/bot');
const { connectMongo, closeMongo } = require('./src/config/database');
const { env, USE_WEBHOOK } = require('./src/config/env');
const loadMiddlewares = require('./src/middlewares');
const loadCommands = require('./src/commands');
const loadHandlers = require('./src/handlers');
const logger = require('./src/utils/logger');

let server = null;

async function main() {
  await connectMongo();
  await initBotInfo();

  loadMiddlewares(bot);
  loadCommands(bot);
  loadHandlers(bot);

  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (origin === env.WEB_ORIGIN || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  app.get('/', (req, res) => res.status(200).send('BIKA Bot OK'));
  app.get('/health', (req, res) => res.json({ ok: true, bot: getBotInfo()?.username || null, uptime: process.uptime(), time: new Date().toISOString() }));

  const webhookPath = env.WEBHOOK_SECRET ? `/telegraf/${env.WEBHOOK_SECRET}` : null;
  const webhookUrl = USE_WEBHOOK && webhookPath ? `${env.PUBLIC_URL}${webhookPath}` : null;
  if (USE_WEBHOOK && webhookPath) app.post(webhookPath, (req, res) => bot.handleUpdate(req.body, res));

  server = app.listen(env.PORT, async () => {
    logger.info(`Web server listening on ${env.PORT}`);
    try { await bot.telegram.deleteWebhook({ drop_pending_updates: true }); } catch (e) { logger.warn(e.message); }
    if (USE_WEBHOOK && webhookUrl) {
      await bot.telegram.setWebhook(webhookUrl);
      logger.info(`Webhook mode enabled: ${webhookUrl}`);
    } else {
      await bot.launch({ dropPendingUpdates: true });
      logger.info('Polling mode enabled');
    }
    logger.info(`Bot username: @${getBotInfo()?.username || 'unknown'}`);
    logger.info(`Owner ID: ${env.OWNER_ID}`);
  });
}

async function shutdown(signal) {
  logger.info(`Shutdown: ${signal}`);
  try { if (server) server.close(); } catch (_) {}
  try { await bot.stop(signal); } catch (_) {}
  try { await closeMongo(); } catch (_) {}
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('UnhandledRejection', reason));
process.on('uncaughtException', (err) => logger.error('UncaughtException', err));

main().catch((err) => { logger.error('BOOT ERROR', err); process.exit(1); });
