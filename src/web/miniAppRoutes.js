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
const { createWebShanRoom, joinWebShan, getWebShanStatus, drawWebShan, stayWebShan, playWebShan, MIN_BET: SHAN_MIN_BET, MAX_BET: SHAN_MAX_BET, MAX_PLAYERS: SHAN_MAX_PLAYERS, JOIN_SECONDS: SHAN_JOIN_SECONDS, ACTION_SECONDS: SHAN_ACTION_SECONDS } = require('../services/webShanService');
const { getAllWebGameRtps } = require('../services/webGameRtpService');
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
    WHEEL_DAILY_USED: [400, 'Daily Free Spin ကို ဒီနေ့ claim လုပ်ပြီးသားပါ။ မနက်ဖြန် ပြန်လာပါ။'],
    BJ_ROOM_NOT_FOUND: [404, 'Blackjack table မတွေ့ပါ။ Group ထဲမှာ .wbj ပြန်ပို့ပြီး table အသစ်ဖွင့်ပါ။'],
    BJ_ROOM_EXPIRED: [400, 'Blackjack table expired ဖြစ်သွားပါပြီ။'],
    BJ_ALREADY_STARTED: [400, 'Blackjack round စပြီးသွားပါပြီ။ နောက် table ကိုစောင့်ပါ။'],
    BJ_TABLE_FULL: [400, 'Blackjack table player ပြည့်သွားပါပြီ။'],
    BJ_NOT_JOINED: [400, 'ဒီ Blackjack table ထဲ မဝင်ထားပါ။'],
    BJ_NOT_PLAYING: [400, 'အခု action time မဟုတ်ပါ။'],
    BJ_ACTION_DONE: [400, 'ဒီ hand အတွက် action လုပ်ပြီးသားပါ။'],
    SHAN_DEAL_RUNNING: [429, 'Shan deal လက်ရှိ run နေပါတယ်။'],
    SHAN_ROOM_NOT_FOUND: [404, 'Shan Koe Mee table မတွေ့ပါ။ Group ထဲမှာ .wshan ပြန်ပို့ပါ သို့မဟုတ် Web ထဲက Create Table နှိပ်ပါ။'],
    SHAN_ROOM_EXPIRED: [400, 'Shan Koe Mee table expired ဖြစ်သွားပါပြီ။ Table အသစ်ထောင်ပါ။'],
    SHAN_ALREADY_STARTED: [400, 'ဒီ Shan table round စပြီးသွားပါပြီ။ Table အသစ်ကိုစောင့်ပါ။'],
    SHAN_TABLE_FULL: [400, 'Shan table player ပြည့်သွားပါပြီ။'],
    SHAN_NOT_JOINED: [400, 'ဒီ Shan table ထဲ မဝင်ထားပါ။'],
    SHAN_NOT_PLAYING: [400, 'အခု Shan action time မဟုတ်ပါ။'],
    SHAN_ACTION_DONE: [400, 'ဒီ hand အတွက် Draw/Stay လုပ်ပြီးသားပါ။'],
    SHAN_MAX_CARDS: [400, 'Shan မှာ card 3 ချပ်ထက်ပိုမဆွဲနိုင်ပါ။'],
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
    minSafe: err?.minSafe,
    nextAtMs: err?.nextAtMs,
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
  startWebCrashLoop();
  const publicDir = options.publicDir || path.join(process.cwd(), 'public', 'miniapp');

  app.get(['/miniapp', '/miniapp/'], (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.get('/api/mini/config', async (req, res) => {
    const rtps = await getAllWebGameRtps().catch(() => ({}));
    return res.json({
      ok: true,
      appUrl: publicMiniAppUrl(),
      botUsername: getBotInfo()?.username || null,
      coin: COIN,
      rtps,
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
      },
      crash: {
        minBet: Number(CRASH.minBet || 50),
        maxBet: Number(CRASH.maxBet || 10000),
        minCashoutMultiplier: Number(CRASH.minCashoutMultiplier || 1.10),
        maxPayoutMultiplier: Number(CRASH.maxPayoutMultiplier || 4),
        maxMultiplier: Number(CRASH.maxMultiplier || 6),
        betSeconds: Number(process.env.WEB_CRASH_BET_SECONDS || CRASH.betSeconds || 15),
        multiplayer: true,
        roundMax: 100,
      },
      blackjack: {
        minBet: BJ_MIN_BET,
        maxBet: BJ_MAX_BET,
        maxPlayers: BJ_MAX_PLAYERS,
        joinSeconds: BJ_JOIN_SECONDS,
        actionSeconds: BJ_ACTION_SECONDS,
      },
      shan: {
        minBet: SHAN_MIN_BET,
        maxBet: SHAN_MAX_BET,
        maxPlayers: SHAN_MAX_PLAYERS,
        joinSeconds: SHAN_JOIN_SECONDS,
        actionSeconds: SHAN_ACTION_SECONDS,
        rules: { initialCards: 2, optionalThirdCard: true, pointModulo: 10, facePoint: 0, acePoint: 1 },
      },
      plinko: {
        minBet: PLINKO_MIN_BET,
        maxBet: PLINKO_MAX_BET,
        buckets: PLINKO_BUCKETS,
      },
      wheel: {
        minBet: WHEEL_MIN_BET,
        maxBet: WHEEL_MAX_BET,
        dailyBaseReward: WHEEL_DAILY_BASE_REWARD,
        segmentDegrees: 36,
        segments: WHEEL_SEGMENTS,
      },
      mines: {
        minBet: MINES_MIN_BET,
        maxBet: MINES_MAX_BET,
        boardSize: 5,
        mines: DEFAULT_MINES,
        minCashoutSafe: MIN_CASHOUT_SAFE,
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


  app.post('/api/mini/history', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const items = await getWebGameHistory(req.telegramUser.id, req.body?.game || 'all', req.body?.limit || 20);
      return res.json({ ok: true, items });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/slot/spin', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await spinWebSlot({ userId: req.telegramUser.id, bet: req.body?.bet });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/crash/start', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await placeWebCrashBet({ userId: req.telegramUser.id, user: req.telegramUser, bet: req.body?.bet });
      return res.json({ ok: true, ...result });
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/crash/bet', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await placeWebCrashBet({ userId: req.telegramUser.id, user: req.telegramUser, bet: req.body?.bet });
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

  app.post('/api/mini/blackjack/status', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await getWebBlackjackStatus({ roomId: req.body?.roomId, userId: req.telegramUser.id });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/blackjack/join', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await joinWebBlackjack({ roomId: req.body?.roomId, userId: req.telegramUser.id, user: req.telegramUser, bet: req.body?.bet });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/blackjack/hit', authMiddleware, async (req, res) => {
    try {
      const result = await hitWebBlackjack({ roomId: req.body?.roomId, userId: req.telegramUser.id });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/blackjack/stand', authMiddleware, async (req, res) => {
    try {
      const result = await standWebBlackjack({ roomId: req.body?.roomId, userId: req.telegramUser.id });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });



  app.post('/api/mini/shan/create', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await createWebShanRoom({
        title: req.body?.title || 'Bika Shan Koe Mee Table',
        createdBy: req.telegramUser.id,
      });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/shan/status', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await getWebShanStatus({ roomId: req.body?.roomId, userId: req.telegramUser.id });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/shan/join', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await joinWebShan({ roomId: req.body?.roomId, userId: req.telegramUser.id, user: req.telegramUser, bet: req.body?.bet });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/shan/draw', authMiddleware, async (req, res) => {
    try {
      const result = await drawWebShan({ roomId: req.body?.roomId, userId: req.telegramUser.id });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/shan/stay', authMiddleware, async (req, res) => {
    try {
      const result = await stayWebShan({ roomId: req.body?.roomId, userId: req.telegramUser.id });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/shan/deal', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await playWebShan({ userId: req.telegramUser.id, bet: req.body?.bet });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/plinko/drop', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await playWebPlinko({ userId: req.telegramUser.id, bet: req.body?.bet });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });


  app.post('/api/mini/wheel/daily-status', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const status = await getDailyWheelStatus(req.telegramUser.id);
      return res.json(status);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/wheel/daily-spin', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await spinDailyWebWheel({ userId: req.telegramUser.id });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/wheel/spin', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await spinWebWheel({ userId: req.telegramUser.id, bet: req.body?.bet });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/mines/start', authMiddleware, async (req, res) => {
    try {
      await ensureUser(normalizeTelegramUser(req.telegramUser));
      const result = await startWebMines({ userId: req.telegramUser.id, bet: req.body?.bet });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/mines/status', authMiddleware, async (req, res) => {
    try {
      const result = await getWebMinesStatus(req.telegramUser.id);
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/mines/open', authMiddleware, async (req, res) => {
    try {
      const result = await openWebMinesTile({ userId: req.telegramUser.id, index: req.body?.index });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });

  app.post('/api/mini/mines/cashout', authMiddleware, async (req, res) => {
    try {
      const result = await cashoutWebMines({ userId: req.telegramUser.id });
      return res.json(result);
    } catch (err) {
      return sendError(res, err);
    }
  });
};

module.exports.publicMiniAppUrl = publicMiniAppUrl;
