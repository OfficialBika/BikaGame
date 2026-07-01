'use strict';

const path = require('path');
const { env } = require('../config/env');
const { COIN, SLOT, CRASH = {} } = require('../config/constants');
const { getBotInfo } = require('../config/bot');
const { ensureUser, getUser } = require('../services/economyService');
const { spinWebSlot } = require('../services/webSlotService');
const { startWebCrash, getWebCrashStatus, cashoutWebCrash } = require('../services/webCrashService');
const { verifyTelegramMiniAppInitData, getInitDataFromRequest } = require('./telegramMiniAuth');

function publicMiniAppUrl() {
  const explicit = process.env.MINIAPP_URL || process.env.WEB_APP_URL;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  if (env.PUBLIC_URL) return `${String(env.PUBLIC_URL).replace(/\/+$/, '')}/miniapp`;
  return '/miniapp';
}

function sendError(res, err) {
  const code = String(err?.message || err || 'ERROR');
  const map = {
    MINIAPP_AUTH_MISSING: [401, 'Telegram login missing. Open this page from Telegram.'],
    MINIAPP_AUTH_INVALID: [401, 'Telegram login invalid.'],
    MINIAPP_AUTH_EXPIRED: [401, 'Telegram login expired. Please reopen the Mini App.'],
    USER_INSUFFICIENT: [400, 'Balance မလုံလောက်ပါ။'],
    USER_NOT_FOUND: [404, 'User data မတွေ့ပါ။ Bot ကို /start အရင်လုပ်ပါ။'],
    INVALID_BET: [400, 'Bet amount မမှန်ပါ။'],
    BET_RANGE: [400, 'Bet amount range မမှန်ပါ။'],
    COOLDOWN: [429, 'Cooldown ခဏစောင့်ပါ။'],
    SPIN_RUNNING: [429, 'Slot spin လက်ရှိ run နေပါတယ်။'],
    CRASH_RUNNING: [400, 'Crash round လက်ရှိ run နေပါတယ်။'],
    NO_ACTIVE_CRASH: [400, 'Active Crash round မရှိပါ။'],
    CASHOUT_LOCKED: [400, 'Cash Out မလုပ်နိုင်သေးပါ။'],
    CASHOUT_PROCESSING: [429, 'Cash Out processing...'],
    CRASHED: [400, 'Crash ဖြစ်သွားပါပြီ။'],
  };
  const [status, message] = map[code] || [500, 'Server error ဖြစ်နေပါတယ်။'];

  return res.status(status).json({
    ok: false,
    error: code,
    message,
    minBet: err?.minBet,
    maxBet: err?.maxBet,
    cooldownLeft: err?.cooldownLeft,
    minMultiplier: err?.minMultiplier,
  });
}

function authMiddleware(req, res, next) {
  try {
    const initData = getInitDataFromRequest(req);
    const auth = verifyTelegramMiniAppInitData(initData);
    req.telegramAuth = auth;
    req.telegramUser = auth.user;
    return next();
  } catch (err) {
    return sendError(res, err);
  }
}

function normalizeTelegramUser(user) {
  return {
    id: user.id,
    username: user.username || null,
    first_name: user.first_name || null,
    last_name: user.last_name || null,
    language_code: user.language_code || null,
    is_premium: !!user.is_premium,
  };
}

module.exports = function registerMiniAppRoutes(app, options = {}) {
  const publicDir = options.publicDir || path.join(process.cwd(), 'public', 'miniapp');

  app.get(['/miniapp', '/miniapp/'], (req, res) => {
    return res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/api/mini/config', (req, res) => {
    return res.json({
      ok: true,
      appUrl: publicMiniAppUrl(),
      botUsername: getBotInfo()?.username || null,
      coin: COIN,
      slot: {
        minBet: Number(SLOT.minBet || 50),
        maxBet: Number(SLOT.maxBet || 7000),
      },
      crash: {
        minBet: Number(CRASH.minBet || 50),
        maxBet: Number(CRASH.maxBet || 10000),
        minCashoutMultiplier: Number(CRASH.minCashoutMultiplier || 1.10),
        maxPayoutMultiplier: Number(CRASH.maxPayoutMultiplier || 4),
      },
    });
  });

  app.post('/api/mini/me', authMiddleware, async (req, res) => {
    try {
      const tgUser = normalizeTelegramUser(req.telegramUser);
      const doc = await ensureUser(tgUser);
      return res.json({
        ok: true,
        coin: COIN,
        user: {
          userId: doc.userId,
          username: doc.username || tgUser.username || null,
          firstName: doc.firstName || tgUser.first_name || null,
          lastName: doc.lastName || tgUser.last_name || null,
          balance: Number(doc.balance || 0),
          totalWon: Number(doc.totalWon || 0),
          totalLost: Number(doc.totalLost || 0),
          isVip: !!doc.isVip,
        },
      });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/slot/spin', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await spinWebSlot({
        userId: req.telegramUser.id,
        bet: req.body?.bet,
      });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/crash/start', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await startWebCrash({
        userId: req.telegramUser.id,
        bet: req.body?.bet,
      });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/crash/status', authMiddleware, async (req, res) => {
    try {
      const result = await getWebCrashStatus(req.telegramUser.id);
      const user = await getUser(req.telegramUser.id);
      return res.json({ ok: true, ...result, balance: Number(user?.balance || 0) });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/crash/cashout', authMiddleware, async (req, res) => {
    try {
      const result = await cashoutWebCrash({ userId: req.telegramUser.id });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendError(res, err);
    }
  });
};

module.exports.publicMiniAppUrl = publicMiniAppUrl;
