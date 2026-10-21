'use strict';

const path = require('path');
const { env } = require('../config/env');
const { COIN, SLOT, CRASH = {} } = require('../config/constants');
const { getBotInfo } = require('../config/bot');
const { ensureUser, getUser } = require('../services/economyService');
const { spinWebSlot } = require('../services/webSlotService');
const { startWebCrashLoop, placeWebCrashBet, getWebCrashStatus, cashoutWebCrash } = require('../services/webCrashService');
const { playWebPlinko, BUCKETS: PLINKO_BUCKETS, MIN_BET: PLINKO_MIN_BET, MAX_BET: PLINKO_MAX_BET } = require('../services/webPlinkoService');
const { spinWebWheel, spinDailyWebWheel, getDailyWheelStatus, SEGMENTS: WHEEL_SEGMENTS, MIN_BET: WHEEL_MIN_BET, MAX_BET: WHEEL_MAX_BET, DAILY_BASE_REWARD: WHEEL_DAILY_BASE_REWARD } = require('../services/webWheelService');
const { startWebMines, getWebMinesStatus, openWebMinesTile, cashoutWebMines, MIN_BET: MINES_MIN_BET, MAX_BET: MINES_MAX_BET, DEFAULT_MINES, MIN_CASHOUT_SAFE } = require('../services/webMinesService');
const { joinWebBlackjack, getWebBlackjackStatus, hitWebBlackjack, standWebBlackjack, MIN_BET: BJ_MIN_BET, MAX_BET: BJ_MAX_BET, MAX_PLAYERS: BJ_MAX_PLAYERS, JOIN_SECONDS: BJ_JOIN_SECONDS, ACTION_SECONDS: BJ_ACTION_SECONDS } = require('../services/webBlackjackService');
const { createWebShanRoom, joinWebShan, getWebShanStatus, drawWebShan, stayWebShan, playWebShan, MIN_BET: SHAN_MIN_BET, MAX_BET: SHAN_MAX_BET, MAX_PLAYERS: SHAN_MAX_PLAYERS, JOIN_SECONDS: SHAN_JOIN_SECONDS, ACTION_SECONDS: SHAN_ACTION_SECONDS, MIN_BANKER_STAKE: SHAN_MIN_BANKER_STAKE, MAX_BANKER_STAKE: SHAN_MAX_BANKER_STAKE } = require('../services/webShanService');
const { getWebGameHistory } = require('../services/webBetHistoryService');
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
    MONGO_TRANSACTIONS_REQUIRED: [503, 'Database transaction support မရသေးပါ။ MongoDB ကို transaction support ပါတဲ့ deployment နဲ့ ချိတ်ပါ။'],
    TREASURY_NOT_READY: [503, 'Bot Bank မပြင်ဆင်ရသေးပါ။ ခဏစောင့်ပြီး ပြန်စမ်းပါ။'],
    TREASURY_INSUFFICIENT: [400, 'Bot Bank balance မလုံလောက်ပါ။'],

    COOLDOWN: [429, 'Cooldown ခဏစောင့်ပါ။'],
    SPIN_RUNNING: [429, 'Slot spin လက်ရှိ run နေပါတယ်။'],
    CRASH_RUNNING: [400, 'Crash round လက်ရှိ run နေပါတယ်။'],
    NOT_BETTING: [400, 'အခု bet time မဟုတ်ပါ။ နောက် round ကိုစောင့်ပါ။'],
    ALREADY_BET: [400, 'ဒီ round မှာ bet ဝင်ပြီးသားပါ။'],
    ROUND_FULL: [400, 'ဒီ round မှာ player ပြည့်နေပါပြီ။'],
    NOT_IN_ROUND: [400, 'သင် ဒီ round မှာ bet မဝင်ထားပါ။'],
    ALREADY_CASHED_OUT: [400, 'Cash Out လုပ်ပြီးသားပါ။'],
    NO_ACTIVE_CRASH: [400, 'Active Crash round မရှိပါ။'],
    CASHOUT_LOCKED: [400, 'Cash Out မလုပ်နိုင်သေးပါ။'],
    CASHOUT_PROCESSING: [429, 'Cash Out processing...'],
    CRASHED: [400, 'Crash ဖြစ်သွားပါပြီ။'],
    MINES_ACTIVE: [400, 'Mines round လက်ရှိ run နေပါတယ်။ Cash Out သို့မဟုတ် mine ထိပြီးမှ အသစ်စပါ။'],
    NO_ACTIVE_MINES: [400, 'Active Mines round မရှိပါ။'],
    INVALID_TILE: [400, 'Tile မမှန်ပါ။'],
    TILE_OPENED: [400, 'ဒီ tile ကိုဖွင့်ပြီးသားပါ။'],
    MINES_CASHOUT_LOCKED: [400, 'Safe tile မလုံလောက်သေးပါ။'],
    WHEEL_DAILY_USED: [400, 'ဒီနေ့ Daily Wheel ကို အသုံးပြုပြီးပါပြီ။'],
    WHEEL_DAILY_COOLDOWN: [429, 'Daily Wheel ခဏစောင့်ပါ။'],
  };
  const mapped = map[code];
  const status = mapped ? mapped[0] : 400;
  const message = mapped ? mapped[1] : code;
  logger.error('Mini App route error', err);
  return res.status(status).json({ ok: false, error: code, message });
}

function loggerFallback() {}

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
  startWebCrashLoop();
  const publicDir = options.publicDir || path.join(process.cwd(), 'public', 'miniapp');

  app.get(['/miniapp', '/miniapp/'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get(['/miniapp/v2', '/miniapp/v2/'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(path.join(publicDir, 'v2', 'index.html'));
  });

  app.get('/api/mini/config', async (req, res) => {
    return res.json({
      ok: true,
      appUrl: publicMiniAppUrl(),
      botUsername: getBotInfo()?.username || null,
      coin: COIN,
      games: [
        { key: 'rocket', title: 'Rocket Crash', badge: 'LIVE', hot: true },
        { key: 'slot', title: 'Premium Slot', badge: 'HOT', hot: true },
        { key: 'blackjack', title: 'Web Blackjack', badge: 'LIVE', hot: true },
        { key: 'shan', title: 'Shan Koe Mee', badge: 'LIVE', hot: true },
        { key: 'plinko', title: 'Plinko', badge: 'NEW', hot: false },
        { key: 'wheel', title: 'Lucky Wheel', badge: 'DAILY', hot: false },
        { key: 'mines', title: 'Web Mines', badge: 'NEW', hot: false },
      ],
      slot: {
        minBet: Number(SLOT.minBet || 50),
        maxBet: Number(SLOT.maxBet || 7000),