'use strict';

const { COIN } = require('../config/constants');
const { getUser, userPayToTreasury, treasuryPayToUser } = require('./economyService');
const { getTreasury } = require('./treasuryService');
const { getWebGameRtp } = require('./webGameRtpService');
const { recordWebGameHistory } = require('./webBetHistoryService');

const activeGames = new Map();
const BOARD_SIZE = 5;
const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
const MIN_BET = Math.max(1, Number(process.env.WEB_MINES_MIN_BET || 50));
const MAX_BET = Math.max(MIN_BET, Number(process.env.WEB_MINES_MAX_BET || 10000));
const DEFAULT_MINES = Math.max(5, Math.min(12, Number(process.env.WEB_MINES_DEFAULT_COUNT || 8)));
const MIN_CASHOUT_SAFE = Math.max(2, Math.min(12, Number(process.env.WEB_MINES_MIN_CASHOUT_SAFE || 3)));
const CAP_PERCENT = Math.max(0.03, Math.min(0.40, Number(process.env.WEB_MINES_CAP_PERCENT || 0.12)));
const MAX_PAYOUT_MULTIPLIER = Math.max(1, Math.min(30, Number(process.env.WEB_MINES_MAX_PAYOUT_MULTIPLIER || 6)));
const TTL_MS = Math.max(60_000, Number(process.env.WEB_MINES_TTL_MS || 5 * 60 * 1000));

function parseBet(value) {
  const n = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.floor(n) : NaN;
}

function cleanUserId(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

function makeId() {
  return `wmn${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function cleanupExpired() {
  const now = Date.now();
  for (const game of activeGames.values()) {
    if (game.state === 'playing' && now - Number(game.createdAtMs || now) > TTL_MS && !game.expiring) {
      game.expiring = true;
      expireMinesGame(game).catch((err) => {
        game.expiring = false;
        console.error('WEB_MINES_EXPIRE_FAILED:', err?.message || err);
      });
    }
  }
}

async function expireMinesGame(game) {
  if (!game || ['lost', 'cashed_out', 'expired'].includes(game.state)) return;
  if (game.processing) { game.expiring = false; return; }
  try {
    await treasuryPayToUser(game.userId, game.bet, {
      type: 'web_mines_refund',
      source: 'miniapp_mines',
      gameId: game.id,
      reason: 'expired',
      idempotencyKey: `${game.id}:expire`,
    });
    game.state = 'expired';
    if (game.expiryTimer) clearTimeout(game.expiryTimer);
    activeGames.delete(game.userId);
  } finally {
    game.expiring = false;
  }
}
function createMinePositions(mineCount, blockedIndex) {
  const blocked = new Set([Number(blockedIndex)]);
  const positions = new Set();
  while (positions.size < mineCount) {
    const idx = Math.floor(Math.random() * TOTAL_CELLS);
    if (blocked.has(idx)) continue;
    positions.add(idx);
  }
  return positions;
}

function multiplier(game) {
  const opened = Math.max(0, game.openedSafe.size - 1); // first safe is free, no payout boost
  if (opened <= 0) return 1;

  const rtp = Math.max(40, Math.min(95, Number(game.rtp || 68))) / 100;
  const totalRiskCells = TOTAL_CELLS - 1;
  const safeRiskCells = TOTAL_CELLS - game.mineCount - 1;
  let m = 1;

  for (let i = 0; i < opened; i += 1) {
    m *= (totalRiskCells - i) / Math.max(1, safeRiskCells - i);
  }

  m *= rtp * 0.88;
  m = Math.min(m, MAX_PAYOUT_MULTIPLIER);
  return Math.max(1.01, Math.floor(m * 100) / 100);
}

function canCashout(game) {
  return game.openedSafe.size >= MIN_CASHOUT_SAFE;
}

async function capPayout(bet, rawPayout) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const maxByPercent = Math.floor(ownerBalance * CAP_PERCENT);
  const maxByBet = Math.floor(Number(bet || 0) * MAX_PAYOUT_MULTIPLIER);
  const hardMax = Math.max(Number(bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(Math.floor(Number(rawPayout) || 0), hardMax));
}

function publicTiles(game, reveal = false) {
  const tiles = [];
  for (let i = 0; i < TOTAL_CELLS; i += 1) {
    const opened = game.openedSafe.has(i);
    const mine = !!game.minePositions?.has(i);
    tiles.push({
      index: i,
      opened,
      mine: reveal ? mine : false,
      exploded: game.explodedIndex === i,
      label: opened ? 'safe' : reveal && mine ? 'mine' : 'hidden',
    });
  }
  return tiles;
}

function publicGame(game, extra = {}) {
  if (!game) return null;
  const reveal = ['lost', 'cashed_out', 'expired'].includes(game.state);
  const m = multiplier(game);
  const rawCashout = canCashout(game) ? Math.floor(game.bet * m) : 0;
  return {
    id: game.id,
    state: game.state,
    coin: COIN,
    bet: game.bet,
    mineCount: game.mineCount,
    boardSize: BOARD_SIZE,
    safeOpened: game.openedSafe.size,
    minCashoutSafe: MIN_CASHOUT_SAFE,
    multiplier: m,
    cashoutLocked: !canCashout(game),
    cashoutEstimate: rawCashout,
    tiles: publicTiles(game, reveal),
    ...extra,
  };
}

async function startWebMines({ userId, bet }) {
  cleanupExpired();
  const finalUserId = cleanUserId(userId);
  const amount = parseBet(bet);
  if (!finalUserId) throw new Error('INVALID_USER');
  if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    const err = new Error('BET_RANGE');
    err.minBet = MIN_BET;
    err.maxBet = MAX_BET;
    throw err;
  }

  if (activeGames.has(finalUserId)) throw new Error('MINES_ACTIVE');

  const user = await getUser(finalUserId);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (Number(user.balance || 0) < amount) throw new Error('USER_INSUFFICIENT');

  const gameId = makeId();
  await userPayToTreasury(finalUserId, amount, {
    type: 'web_mines_bet', source: 'miniapp_mines', mines: DEFAULT_MINES,
    gameId, idempotencyKey: `${gameId}:bet`,
  });

  const game = {
    id: gameId,
    userId: finalUserId,
    bet: amount,
    mineCount: DEFAULT_MINES,
    rtp: await getWebGameRtp('mines'),
    state: 'playing',
    openedSafe: new Set(),
    minePositions: null,
    explodedIndex: null,
    createdAtMs: Date.now(),
    processing: null,
    expiring: false,
  };

  activeGames.set(finalUserId, game);
  game.expiryTimer = setTimeout(() => expireMinesGame(game).catch((err) => console.error('WEB_MINES_EXPIRE_TIMER_FAILED:', err?.message || err)), TTL_MS + 25);
  const updated = await getUser(finalUserId);
  return { ok: true, balance: Number(updated?.balance || 0), game: publicGame(game) };
}

async function getWebMinesStatus(userId) {
  cleanupExpired();
  const finalUserId = cleanUserId(userId);
  const game = activeGames.get(finalUserId);
  const user = await getUser(finalUserId);
  return { ok: true, active: !!game, balance: Number(user?.balance || 0), game: publicGame(game) };
}

async function openWebMinesTile({ userId, index }) {
  cleanupExpired();
  const finalUserId = cleanUserId(userId);
  const cell = Number(index);
  const game = activeGames.get(finalUserId);
  if (!game || game.state !== 'playing') throw new Error('NO_ACTIVE_MINES');
  if (!Number.isInteger(cell) || cell < 0 || cell >= TOTAL_CELLS) throw new Error('INVALID_TILE');
  if (game.openedSafe.has(cell)) throw new Error('TILE_OPENED');

  if (!game.minePositions) game.minePositions = createMinePositions(game.mineCount, cell);

  if (game.minePositions.has(cell)) {
    game.state = 'lost';
    game.explodedIndex = cell;
    activeGames.delete(finalUserId);
    await recordWebGameHistory({
      userId: finalUserId,
      game: 'mines',
      title: `BOOM after ${game.openedSafe.size} safe`,
      outcome: 'lose',
      bet: game.bet,
      payout: 0,
      net: -game.bet,
      multiplier: multiplier(game),
      label: 'BOOM',
      meta: { mines: game.mineCount, safeOpened: game.openedSafe.size, explodedIndex: cell, rtp: game.rtp },
    });
    const updated = await getUser(finalUserId);
    return { ok: true, result: 'lost', balance: Number(updated?.balance || 0), payout: 0, game: publicGame(game) };
  }

  game.openedSafe.add(cell);
  const updated = await getUser(finalUserId);
  return { ok: true, result: 'safe', balance: Number(updated?.balance || 0), game: publicGame(game) };
}

async function cashoutWebMines({ userId }) {
  cleanupExpired();
  const finalUserId = cleanUserId(userId);
  const game = activeGames.get(finalUserId);
  if (!game || game.state !== 'playing') throw new Error('NO_ACTIVE_MINES');
  if (game.processing || game.expiring) throw new Error(game.expiring ? 'MINES_EXPIRING' : 'MINES_CASHOUT_PROCESSING');
  if (!canCashout(game)) { const err=new Error('MINES_CASHOUT_LOCKED'); err.minSafe=MIN_CASHOUT_SAFE; throw err; }

  game.processing='cashout';
  try {
    const m=multiplier(game);
    const rawPayout=Math.floor(game.bet*m);
    const payout=await capPayout(game.bet,rawPayout);
    if (payout>0) {
      await treasuryPayToUser(finalUserId,payout,{
        type:'web_mines_win', source:'miniapp_mines', gameId:game.id, bet:game.bet, payout, rawPayout, multiplier:m, mines:game.mineCount, safeOpened:game.openedSafe.size, rtp:game.rtp, idempotencyKey:`${game.id}:cashout`,
      });
    }
    game.state='cashed_out';
    if (game.expiryTimer) clearTimeout(game.expiryTimer);
    activeGames.delete(finalUserId);
    await recordWebGameHistory({userId:finalUserId,game:'mines',title:`${game.openedSafe.size} safe gems`,outcome:payout>game.bet?'win':payout>0?'paid':'lose',bet:game.bet,payout,net:payout-game.bet,multiplier:m,label:`x${m.toFixed(2)}`,meta:{mines:game.mineCount,safeOpened:game.openedSafe.size,rawPayout,rtp:game.rtp,gameId:game.id}});
    const updated=await getUser(finalUserId);
    return {ok:true,result:'cashed_out',payout,rawPayout,balance:Number(updated?.balance||0),game:publicGame(game,{payout})};
  } finally {
    game.processing=null;
  }
}

module.exports = {
  startWebMines,
  getWebMinesStatus,
  openWebMinesTile,
  cashoutWebMines,
  MIN_BET,
  MAX_BET,
  DEFAULT_MINES,
  MIN_CASHOUT_SAFE,
};
