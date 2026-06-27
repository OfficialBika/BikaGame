require('dotenv').config();

const express = require('express');
const { bot, initBotInfo, getBotInfo } = require('./src/config/bot');
const { connectMongo, closeMongo } = require('./src/config/database');
const { env, USE_WEBHOOK } = require('./src/config/env');
const logger = require('./src/utils/logger');

let server = null;
let isReady = false;
let fallbackCommandsLoaded = false;

const COMMAND_MODULES = [
  './src/commands/admin/treasury',
  './src/commands/admin/promoRtp',
  './src/commands/admin/broadcast',
  './src/commands/admin/vip',
  './src/commands/admin/maintenance',
  './src/commands/admin/status',
  './src/commands/admin/groupApproval',
  './src/commands/user/start',
  './src/commands/user/balance',
  './src/commands/user/daily',
  './src/commands/user/gift',
  './src/commands/user/top10',
  './src/commands/user/dailyTournament',
  './src/commands/user/wallet',
  './src/commands/user/sell',
  './src/commands/games/slot',
  './src/commands/games/mines',
  './src/commands/games/dice',
  './src/commands/games/shan',
  './src/commands/games/blackjack',
  './src/commands/shop/shop',
];

function moduleExists(modulePath) {
  try {
    require.resolve(modulePath);
    return true;
  } catch (err) {
    if (err?.code === 'MODULE_NOT_FOUND') return false;
    throw err;
  }
}

function requireLoader(modulePath, label) {
  if (!moduleExists(modulePath)) {
    throw new Error(`${label} loader not found: ${modulePath}`);
  }

  const loader = require(modulePath);

  if (typeof loader !== 'function') {
    throw new TypeError(`${label} loader must export a function: ${modulePath}`);
  }

  return loader;
}

function loadFallbackCommands(targetBot) {
  let loaded = 0;
  let skipped = 0;

  for (const modulePath of COMMAND_MODULES) {
    if (!moduleExists(modulePath)) {
      skipped += 1;
      logger.warn(`Command module not found; skipped: ${modulePath}`);
      continue;
    }

    const registerCommand = require(modulePath);

    if (typeof registerCommand !== 'function') {
      throw new TypeError(`Command module must export a function: ${modulePath}`);
    }

    registerCommand(targetBot);
    loaded += 1;
  }

  fallbackCommandsLoaded = true;
  logger.info(`Fallback command loader completed: loaded=${loaded}, skipped=${skipped}`);
}

function loadAllModules(targetBot) {
  const loadMiddlewares = requireLoader('./src/middlewares', 'Middleware');
  const loadHandlers = requireLoader('./src/handlers', 'Handler');

  loadMiddlewares(targetBot);

  if (moduleExists('./src/commands')) {
    const loadCommands = require('./src/commands');

    if (typeof loadCommands === 'function') {
      loadCommands(targetBot);
    } else {
      logger.warn('./src/commands/index.js does not export a function; using fallback command loader');
      loadFallbackCommands(targetBot);
    }
  } else {
    logger.warn('./src/commands loader not found; using fallback command loader');
    loadFallbackCommands(targetBot);
  }

  loadHandlers(targetBot);
}


function registerRuntimeCommands(targetBot) {
  const modulePath = './src/commands/admin/promoRtp';

  if (fallbackCommandsLoaded) {
    logger.info('Promo RTP command already handled by fallback command loader; runtime register skipped');
    return;
  }

  if (!moduleExists(modulePath)) {
    logger.warn('Promo RTP command not found; /promortp skipped');
    return;
  }

  const registerPromoRtp = require(modulePath);

  if (typeof registerPromoRtp !== 'function') {
    throw new TypeError(`Promo RTP command module must export a function: ${modulePath}`);
  }

  registerPromoRtp(targetBot);
  logger.info('Promo RTP command registered');
}

async function restoreRuntimeServices(targetBot) {
  const modulePath = './src/services/promoRtpService';

  if (!moduleExists(modulePath)) {
    logger.warn('Promo RTP service not found; promo timer restore skipped');
    return;
  }

  const promoRtpService = require(modulePath);

  if (typeof promoRtpService.restorePromoTimers !== 'function') {
    logger.warn('Promo RTP service does not export restorePromoTimers; promo timer restore skipped');
    return;
  }

  try {
    await promoRtpService.restorePromoTimers(targetBot);
    logger.info('Promo RTP timers restored');
  } catch (err) {
    logger.error('Promo RTP timer restore failed', err);
  }
}

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (
      origin &&
      (
        origin === env.WEB_ORIGIN ||
        origin.startsWith('http://localhost:') ||
        origin.startsWith('http://127.0.0.1:')
      )
    ) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }

    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-KEY');

    if (req.method === 'OPTIONS') return res.sendStatus(204);

    return next();
  });

  app.get('/', (req, res) => {
    return res.status(200).send('BIKA Bot OK');
  });

  app.get('/health', (req, res) => {
    const statusCode = isReady ? 200 : 503;

    return res.status(statusCode).json({
      ok: isReady,
      bot: getBotInfo()?.username || null,
      mode: USE_WEBHOOK ? 'webhook' : 'polling',
      uptime: process.uptime(),
      time: new Date().toISOString(),
    });
  });

  return app;
}

function handleWebhookUpdate(update) {
  setImmediate(() => {
    bot.handleUpdate(update).catch((err) => {
      logger.error('Webhook update error', err);
    });
  });
}

async function startTelegramBot(app) {
  const webhookPath = env.WEBHOOK_SECRET
    ? `/telegraf/${env.WEBHOOK_SECRET}`
    : null;

  const webhookUrl =
    USE_WEBHOOK && webhookPath
      ? `${String(env.PUBLIC_URL).replace(/\/+$/, '')}${webhookPath}`
      : null;

  if (USE_WEBHOOK && webhookPath) {
    app.post(webhookPath, (req, res) => {
      res.sendStatus(200);
      handleWebhookUpdate(req.body);
    });
  }

  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: true });
  } catch (err) {
    logger.warn(`deleteWebhook warning: ${err?.message || err}`);
  }

  if (USE_WEBHOOK && webhookUrl) {
    await bot.telegram.setWebhook(webhookUrl, {
      max_connections: Number(process.env.WEBHOOK_MAX_CONNECTIONS || 40),
      drop_pending_updates: true,
    });

    logger.info(`Webhook mode enabled: ${webhookUrl}`);
  } else {
    await bot.launch({ dropPendingUpdates: true });
    logger.info('Polling mode enabled');
  }
}

function listen(app) {
  return new Promise((resolve, reject) => {
    server = app.listen(env.PORT, () => {
      logger.info(`Web server listening on ${env.PORT}`);
      resolve();
    });

    server.once('error', reject);
  });
}

async function main() {
  await connectMongo();
  await initBotInfo();

  loadAllModules(bot);
  registerRuntimeCommands(bot);

  const app = createApp();

  await listen(app);
  await startTelegramBot(app);
  await restoreRuntimeServices(bot);

  isReady = true;

  logger.info(`Bot username: @${getBotInfo()?.username || 'unknown'}`);
  logger.info(`Owner ID: ${env.OWNER_ID}`);
}

async function shutdown(signal) {
  logger.info(`Shutdown: ${signal}`);
  isReady = false;

  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  } catch (err) {
    logger.warn(`HTTP server close warning: ${err?.message || err}`);
  }

  try {
    await bot.stop(signal);
  } catch (err) {
    logger.warn(`Bot stop warning: ${err?.message || err}`);
  }

  try {
    await closeMongo();
  } catch (err) {
    logger.warn(`Mongo close warning: ${err?.message || err}`);
  }

  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

process.on('unhandledRejection', (reason) => {
  logger.error('UnhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
  logger.error('UncaughtException', err);
});

main().catch((err) => {
  logger.error('BOOT ERROR', err);
  process.exit(1);
});
