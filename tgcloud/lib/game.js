import { db, EndpointError } from 'sdk';
import { and, desc, eq, gte, sql } from 'sdk/db';
import { gameHistory, gameSessions, users } from '../schema.js';
import { ensureEconomy, ensureUser, userById as accountUserById, debit as ledgerDebit, credit as ledgerCredit, settleSingleGame, settleAward, getTreasury, getSetting, consumeCooldown, getTransaction, hasIdempotencyKey, recordGame as ledgerRecordGame } from './economy.js';
import { spin as slotSpinEngine, multiplier as slotMultiplier, art as slotArt } from './slotPolicy.js';
import { getActivePromoRtp } from './eventMarkets.js';
import { MINES_RULES, normalizeMineCount, generateMineLayout, calculateMinesMultiplier, canCashOutMines, minesExpiryTime, isMinesExpired } from './minesPolicy.js';
import { BLACKJACK_RULES, normalizeBlackjackRoom, clampBlackjackRtp, createBlackjackDeck, cardValue as blackjackCardValue, isNaturalBlackjack, resultForBlackjack, blackjackPayout, buildBlackjackSettlementPlan } from './blackjackPolicy.js';

const MIN_BET = 1;
const MAX_BET = 1000000;
const now = () => new Date();
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const n = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
function betOf(value) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < MIN_BET || amount > MAX_BET) {
    throw new Error('INVALID_BET');
  }
  return amount;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export async function userById(userId) {
  return accountUserById(userId);
}

export async function ensurePreviewUser(tgUser) {
  return ensureUser(tgUser);
}

export async function debit(userId, amount, type = 'bet', meta = {}, key) {
  return ledgerDebit(userId, amount, type, meta, key);
}

export async function credit(userId, amount, type = 'win', meta = {}, key) {
  return ledgerCredit(userId, amount, type, meta, key);
}

export async function recordGame(userId, game, bet, payout, result, multiplier = 0, settlementId = null) {
  return ledgerRecordGame({
    userId, game, bet, payout, result, multiplier,
    key: settlementId ? 'history:' + String(settlementId) : null,
  });
}

export async function history(userId, game = 'all', limit = 20) {
  const take = clamp(Math.floor(n(limit, 20)), 1, 100);
  const q = db.select().from(gameHistory).where(eq(gameHistory.userId, Number(userId))).orderBy(desc(gameHistory.createdAt)).limit(take);
  const rows = await q.all();
  return game === 'all' ? rows : rows.filter((x) => x.game === game).slice(0, take);
}

async function activeSession(userId, game) {
  return db.select().from(gameSessions).where(and(eq(gameSessions.userId, Number(userId)), eq(gameSessions.game, game), eq(gameSessions.status, 'active'))).get();
}

async function createSession(userId, game, state, explicitId = null) {
  const t = now();
  const id = explicitId || uid();
  await db.insert(gameSessions).values({ id, userId: Number(userId), game, status: 'active', state, createdAt: t, updatedAt: t }).run();
  return db.select().from(gameSessions).where(eq(gameSessions.id, id)).get();
}

async function updateSession(id, state, status = 'active') {
  await db.update(gameSessions).set({ state, status, updatedAt: now() }).where(eq(gameSessions.id, id)).run();
  return db.select().from(gameSessions).where(eq(gameSessions.id, id)).get();
}

async function startWagerSession(userId, game, amount, requestId, makeState) {
  const id = Number(userId), bet = betOf(amount);
  const requestKey = String(requestId || '').trim().slice(0, 120);
  const sessionId = operationId(game, id, requestKey);
  const activeError = game === 'crash' ? 'CRASH_RUNNING' : 'MINES_ACTIVE';
  const betType = game === 'crash' ? 'crash_bet' : 'mines_bet';

  async function fund(session) {
    if (session.state?.funded !== false) return session;
    try {
      await debit(id, bet, betType, { game, sessionId: session.id }, game + '-bet:' + session.id);
    } catch (error) {
      // A timeout can happen after the debit committed. Check the stable ledger
      // key before cancelling, otherwise a paid wager could be orphaned.
      let committed;
      try { committed = await getTransaction(game + '-bet:' + session.id); }
      catch (_) { throw error; }
      if (committed) return updateSession(session.id, { ...session.state, funded: true });
      try { await updateSession(session.id, { ...session.state, funded: false }, 'cancelled'); } catch (_) {}
      throw error;
    }
    return updateSession(session.id, { ...session.state, funded: true });
  }

  let session = await activeSession(id, game);
  if (session) {
    if (requestKey && session.id !== sessionId) throw new Error(activeError);
    if (Number(session.state?.bet) !== bet) throw new Error(activeError);
    return fund(session);
  }

  const state = { ...makeState(bet), funded: false, requestId: requestKey || null };
  try {
    session = await createSession(id, game, state, sessionId);
  } catch (error) {
    session = await activeSession(id, game);
    if (!session) {
      const previous = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).get();
      if (previous) throw new Error('SESSION_ALREADY_FINISHED');
      throw error;
    }
    if (requestKey && session.id !== sessionId) throw new Error(activeError);
    if (Number(session.state?.bet) !== bet) throw new Error(activeError);
  }
  return fund(session);
}

function weighted(items) {
  const total = items.reduce((a, x) => a + x.w, 0);
  let r = Math.random() * total;
  for (const x of items) { r -= x.w; if (r < 0) return x.v; }
  return items[items.length - 1].v;
}

const wheelSegments = [
  { index: 0, label: '0x', multiplier: 0, color: '#ef4444', weight: 22 },
  { index: 1, label: '0.2x', multiplier: 0.2, color: '#fb7185', weight: 16 },
  { index: 2, label: '0.5x', multiplier: 0.5, color: '#f59e0b', weight: 16 },
  { index: 3, label: '1x', multiplier: 1, color: '#22d3ee', weight: 14 },
  { index: 4, label: '1.5x', multiplier: 1.5, color: '#3b82f6', weight: 10 },
  { index: 5, label: '2x', multiplier: 2, color: '#22c55e', weight: 7 },
  { index: 6, label: '3x', multiplier: 3, color: '#a855f7', weight: 4.2 },
  { index: 7, label: '5x', multiplier: 5, color: '#eab308', weight: 1.8 },
  { index: 8, label: '8x', multiplier: 8, color: '#f97316', weight: 0.8 },
  { index: 9, label: 'JACK', multiplier: 12, color: '#f43f5e', weight: 0.22 },
];
const plinkoBuckets = [
  { index: 0, label: '0x', multiplier: 0, color: 'red', weight: 18 },
  { index: 1, label: '0.2x', multiplier: 0.2, color: 'red', weight: 18 },
  { index: 2, label: '0.5x', multiplier: 0.5, color: 'yellow', weight: 18 },
  { index: 3, label: '0.8x', multiplier: 0.8, color: 'yellow', weight: 15 },
  { index: 4, label: '1x', multiplier: 1, color: 'blue', weight: 13 },
  { index: 5, label: '1.5x', multiplier: 1.5, color: 'blue', weight: 8 },
  { index: 6, label: '2x', multiplier: 2, color: 'green', weight: 5 },
  { index: 7, label: '3x', multiplier: 3, color: 'green', weight: 3 },
  { index: 8, label: '5x', multiplier: 5, color: 'purple', weight: 1.2 },
  { index: 9, label: '10x', multiplier: 10, color: 'gold', weight: 0.35 },
];

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight ?? item.w ?? 0)), 0);
  let cursor = Math.random() * Math.max(1, total);
  for (const item of items) {
    cursor -= Math.max(0, Number(item.weight ?? item.w ?? 0));
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}
function validBet(value, min, max) {
  const amount = Number(String(value ?? '').replace(/,/g, '').trim());
  if (!Number.isSafeInteger(amount) || amount < min || amount > max) {
    const err = new EndpointError('Bet amount range မမှန်ပါ။', { code: 'BET_RANGE', minBet: min, maxBet: max });
    throw err;
  }
  return amount;
}
function operationId(prefix, userId, supplied) {
  const raw = String(supplied || '').trim().slice(0, 140);
  return raw ? prefix + ':' + userId + ':' + raw : prefix + ':' + userId + ':' + uid();
}
function rtpWeights(items, rtp, plinko = false) {
  const target = Math.max(40, Math.min(95, Number(rtp || (plinko ? 72 : 70)))) / 100;
  const highBoost = plinko ? 0.45 + target * 0.92 : 0.35 + target * 0.88;
  const lossBoost = plinko ? 1.35 - target * 0.72 : 1.42 - target * 0.74;
  return items.map((item) => {
    let weight = Number(item.weight);
    if (item.multiplier < 1) weight *= lossBoost;
    else if (item.multiplier === 1) weight *= plinko ? 0.95 : 1;
    else weight *= highBoost / Math.max(1, item.multiplier * (plinko ? 0.55 : 0.6));
    return { ...item, weight: Math.max(plinko ? 0.05 : 0.03, weight) };
  });
}
async function capPayout(bet, rawPayout, capPercent, maxMultiplier, slot = false) {
  const treasury = await getTreasury();
  const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
  const raw = Math.max(0, Math.floor(Number(rawPayout) || 0));
  if (slot) {
    const cap = Math.floor(ownerBalance * capPercent);
    return Math.max(0, Math.min(raw, cap, ownerBalance));
  }
  const maxByPercent = Math.floor(ownerBalance * capPercent);
  const maxByBet = Math.floor(Number(bet || 0) * maxMultiplier);
  const hardMax = Math.max(Number(bet || 0), Math.min(ownerBalance, maxByPercent > 0 ? maxByPercent : ownerBalance, maxByBet));
  return Math.max(0, Math.min(raw, hardMax));
}
function keyFor(typePrefix, settlementId) {
  return '__settlement:' + typePrefix + ':' + String(settlementId);
}
async function priorSettlement(typePrefix, settlementId) {
  const key = keyFor(typePrefix, settlementId);
  const previous = await getTransaction(key);
  if (previous) return previous;
  if (await hasIdempotencyKey(key)) {
    throw new EndpointError('ဒီ operation ကို settle လုပ်ပြီးသားပါ။', { code: 'DUPLICATE_OPERATION' });
  }
  return null;
}
async function settlementGame({ userId, game, typePrefix, bet, payout, multiplier, result, meta, settlementId }) {
  return settleSingleGame({ userId, game, typePrefix, bet, payout, multiplier, result, meta, settlementId });
}
function slotResponse(row, userBalance) {
  const meta = row.meta || {};
  const reels = Array.isArray(meta.reels) ? meta.reels : ['🍒','🍋','🍉'];
  const bet = Number(row.betAmount || meta.bet || 0);
  const payout = Number(row.payoutAmount || meta.payout || 0);
  return { ok: true, duplicate: true, coin: '$', game: 'slot', bet, reels, art: slotArt(reels), multiplier: Number(row.multiplier || meta.multiplier || 0), rawPayout: Number(meta.rawPayout || payout), payout, net: payout - bet, balance: Number(userBalance || 0), result: payout > 0 ? 'WIN' : 'LOSE', rtp: Number(meta.rtp || meta.rtpWinRate || 65) };
}
export async function playSlot(userId, amount, spinId = null, options = {}) {
  await ensureEconomy();
  const id = Number(userId);
  const user = await userById(id);
  if (!user) throw new EndpointError('User data မတွေ့ပါ။', { code: 'USER_NOT_FOUND' });
  const bet = validBet(amount, 50, 15000);
  const settlementId = operationId('slot', id, spinId);
  const prior = await priorSettlement('web_slot', settlementId);
  if (prior) return slotResponse(prior, user.balance);

  await consumeCooldown(id, 'slot', 700);
  if (Number(user.balance || 0) < bet) throw new EndpointError('Balance မလုံလောက်ပါ။', { code: 'USER_INSUFFICIENT' });

  // Main branch semantics: global /setrtp applies to Telegram slot; promo RTP
  // overrides it for that group. The Mini App has a separately configurable RTP.
  const source = options?.source === 'telegram' ? 'telegram' : 'miniapp';
  const house = await getTreasury();
  const globalRtp = Math.max(0, Math.min(100, Number(house?.rtpWinRate ?? 35)));
  let rtp = source === 'telegram'
    ? globalRtp
    : Math.max(0, Math.min(100, Number(await getSetting('web_game_rtp_slot', 65))));
  let rtpMode = source === 'telegram' ? 'global' : 'miniapp';
  let promoRtpId = null;
  let promoExpiresAt = null;
  if (source === 'telegram') {
    try {
      const promo = await getActivePromoRtp(options.groupId);
      if (promo) {
        rtp = Math.max(0, Math.min(100, Number(promo.rtp ?? globalRtp)));
        rtpMode = 'promo';
        promoRtpId = promo._id?.toString?.() || String(promo._id || '');
        promoExpiresAt = promo.expiresAt || null;
      }
    } catch (_) {
      // Match main: a promo lookup failure falls back to the global RTP.
      rtp = globalRtp;
    }
  }

  const reels = slotSpinEngine(user, Number(house?.vipWinRate ?? 90), Math.random, rtp);
  const multiplier = Number(slotMultiplier(reels)) || 0;
  const rawPayout = Math.floor(bet * multiplier);
  const payout = await capPayout(bet, rawPayout, 0.30, 999999999, true);
  const meta = {
    source,
    groupId: source === 'telegram' ? String(options.groupId || '') : null,
    title: reels.join(' '),
    outcome: payout > bet ? 'win' : payout > 0 ? 'paid' : 'lose',
    reels,
    rawPayout,
    multiplier,
    rtp,
    globalRtpWinRate: globalRtp,
    rtpMode,
    promoRtpId,
    promoExpiresAt,
    vip: !!user.isVip,
  };
  const result = await settlementGame({ userId: id, game: 'slot', typePrefix: 'web_slot', bet, payout, multiplier, result: reels, meta, settlementId });
  const settled = await getTransaction(keyFor('web_slot', settlementId));
  const output = settled ? slotResponse(settled, result.balance) : slotResponse({ ...result, meta }, result.balance);
  return { ...output, duplicate: !!result.duplicate };
}

function buildPlinkoPath(bucketIndex) {
  const path = []; let pos = 5;
  for (let i = 0; i < 14; i += 1) {
    const wantRight = bucketIndex > pos;
    const randomRight = Math.random() > 0.5;
    const dir = Math.random() < 0.68 ? wantRight : randomRight;
    pos = Math.max(0, Math.min(9, pos + (dir ? 1 : -1)));
    path.push(dir ? 'R' : 'L');
  }
  return path;
}
function plinkoResponse(row, userBalance) {
  const meta = row.meta || {};
  const bucket = meta.bucket || plinkoBuckets[0];
  const bet = Number(row.betAmount || meta.bet || 0);
  const payout = Number(row.payoutAmount || meta.payout || 0);
  return { ok: true, duplicate: true, coin: '$', game: 'plinko', bet, bucket: { index: bucket.index, label: bucket.label, multiplier: bucket.multiplier, color: bucket.color }, path: meta.path || [], rawPayout: Number(meta.rawPayout || payout), payout, net: payout - bet, balance: Number(userBalance || 0), multiplier: Number(row.multiplier || bucket.multiplier || 0), rtp: Number(meta.rtp || 72), buckets: plinkoBuckets.map(({weight,...v})=>v) };
}
export async function playPlinko(userId, amount, spinId = null) {
  await ensureEconomy();
  const id = Number(userId), user = await userById(userId);
  if (!user) throw new EndpointError('User data မတွေ့ပါ။', { code: 'USER_NOT_FOUND' });
  const bet = validBet(amount, 50, 10000);
  const settlementId = operationId('plinko', id, spinId);
  const prior = await priorSettlement('web_plinko', settlementId);
  if (prior) return plinkoResponse(prior, user.balance);
  if (Number(user.balance || 0) < bet) throw new EndpointError('Balance မလုံလောက်ပါ။', { code: 'USER_INSUFFICIENT' });
  const rtp = Number(await getSetting('web_game_rtp_plinko', 72));
  const bucket = weightedPick(rtpWeights(plinkoBuckets, rtp, true));
  const path = buildPlinkoPath(bucket.index);
  const rawPayout = Math.floor(bet * bucket.multiplier);
  const payout = await capPayout(bet, rawPayout, 0.12, 10);
  const meta = { source: 'miniapp_plinko', title: bucket.label, outcome: payout > bet ? 'win' : payout > 0 ? 'paid' : 'lose', bucket: {index:bucket.index,label:bucket.label,multiplier:bucket.multiplier,color:bucket.color}, path, rawPayout, rtp };
  const result = await settlementGame({ userId: id, game: 'plinko', typePrefix: 'web_plinko', bet, payout, multiplier: bucket.multiplier, result: { bucket: bucket.index, path }, meta, settlementId });
  const settled = await getTransaction(keyFor('web_plinko', settlementId));
  return settled ? plinkoResponse(settled, result.balance) : plinkoResponse({ ...result, meta }, result.balance);
}
function stopAngleForSegment(index, jitter = 0) {
  const center = Number(index || 0) * 36 + 18;
  return ((360 - center + Number(jitter || 0)) % 360 + 360) % 360;
}
function wheelResponse(row, balance) {
  const meta = row.meta || {};
  const segment = meta.segment || wheelSegments[0];
  const bet = Number(row.betAmount || meta.bet || 0);
  const payout = Number(row.payoutAmount || meta.payout || 0);
  const jitter = Number(meta.stopAngleJitter || 0);
  return { ok: true, duplicate: true, mode: 'paid', game: 'wheel', coin: '$', rtp: Number(meta.rtp || 70), bet, segment: {index:segment.index,label:segment.label,multiplier:segment.multiplier,color:segment.color}, stopAngleDegrees: stopAngleForSegment(segment.index, jitter), stopAngleJitter: jitter, payout, rawPayout: Number(meta.rawPayout || payout), net: payout - bet, balance: Number(balance || 0), duplicate: true };
}
export async function wheelSpin(userId, amount, spinId = null) {
  await ensureEconomy();
  const id = Number(userId), user = await userById(userId);
  if (!user) throw new EndpointError('User data မတွေ့ပါ။', { code: 'USER_NOT_FOUND' });
  const bet = validBet(amount, 50, 10000);
  const settlementId = operationId('wheel', id, spinId);
  const prior = await priorSettlement('web_wheel', settlementId);
  if (prior) return wheelResponse(prior, user.balance);
  if (Number(user.balance || 0) < bet) throw new EndpointError('Balance မလုံလောက်ပါ။', { code: 'USER_INSUFFICIENT' });
  const rtp = Number(await getSetting('web_game_rtp_wheel', 70));
  const segment = weightedPick(rtpWeights(wheelSegments, rtp));
  const rawPayout = Math.floor(bet * segment.multiplier);
  const payout = await capPayout(bet, rawPayout, 0.12, 8);
  const jitter = (Math.random() * 12) - 6;
  const meta = { source: 'miniapp_wheel', title: 'Wheel ' + segment.label, outcome: payout > bet ? 'win' : payout > 0 ? 'paid' : 'lose', segment, rawPayout, rtp, stopAngleJitter: jitter };
  const result = await settlementGame({ userId: id, game: 'wheel', typePrefix: 'web_wheel', bet, payout, multiplier: segment.multiplier, result: segment, meta, settlementId });
  const settled = await getTransaction(keyFor('web_wheel', settlementId));
  return settled ? wheelResponse(settled, result.balance) : wheelResponse({ ...result, meta }, result.balance);
}
export async function wheelDailyStatus(userId) {
  await ensureEconomy();
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new EndpointError('Invalid user.', { code: 'INVALID_USER' });
  const dateKey = new Date().toISOString().slice(0,10);
  const settlementId = id + ':' + dateKey;
  const key = keyFor('web_wheel_daily', settlementId);
  const used = (await getTransaction(key)) || (await hasIdempotencyKey(key));
  return { ok: true, available: !used, dateKey, baseReward: 500, nextAtMs: Date.parse(dateKey + 'T00:00:00.000Z') + 86400000, last: used && typeof used === 'object' ? { payout: Number(used.payoutAmount || 0), label: used.meta?.segment?.label || null, multiplier: Number(used.multiplier || 0) } : null };
}
export async function dailyWheel(userId) {
  await ensureEconomy();
  const id = Number(userId), user = await userById(userId);
  if (!user) throw new EndpointError('User data မတွေ့ပါ။', { code: 'USER_NOT_FOUND' });
  const dateKey = new Date().toISOString().slice(0,10);
  const settlementId = id + ':' + dateKey;
  const key = keyFor('web_wheel_daily', settlementId);
  const prior = await priorSettlement('web_wheel_daily', settlementId);
  if (prior) throw new EndpointError('ဒီနေ့ Daily Wheel ကို သုံးပြီးပါပြီ။', { code: 'WHEEL_DAILY_USED' });
  const rtp = Number(await getSetting('web_game_rtp_wheel', 70));
  const segment = weightedPick(rtpWeights(wheelSegments, rtp));
  const rawPayout = Math.floor(500 * segment.multiplier);
  const payout = await capPayout(500, rawPayout, 0.12, 8);
  const meta = { source: 'miniapp_wheel_daily', title: 'Daily Wheel ' + segment.label, outcome: payout > 0 ? 'daily_win' : 'daily_lose', segment, rawPayout, rtp, dateKey, baseReward: 500, stopAngleJitter: (Math.random() * 12) - 6 };
  const result = await settlementGame({ userId: id, game: 'wheel', typePrefix: 'web_wheel_daily', bet: 0, payout, multiplier: segment.multiplier, result: segment, meta, settlementId });
  if (result.duplicate) throw new EndpointError('ဒီနေ့ Daily Wheel ကို သုံးပြီးပါပြီ။', { code: 'WHEEL_DAILY_USED' });
  return { ok: true, mode: 'daily', game: 'wheel', coin: '$', rtp, bet: 0, baseReward: 500, segment: {index:segment.index,label:segment.label,multiplier:segment.multiplier,color:segment.color}, stopAngleDegrees: stopAngleForSegment(segment.index, meta.stopAngleJitter), payout, rawPayout, net: payout, balance: result.balance, daily: await wheelDailyStatus(id) };
}

function crashPoint() { return Math.max(1.01, Math.floor((1.01 + Math.random() * Math.random() * 7) * 100) / 100); }
export async function crashStart(userId, amount, requestId = null) {
  const session = await startWagerSession(userId, 'crash', amount, requestId, (bet) => ({
    bet, point: crashPoint(), startedAt: Date.now(), cashedOut: false,
  }));
  return { ok: true, sessionId: session.id, phase: 'running', multiplier: 1, balance: (await userById(userId)).balance };
}
export async function crashStatus(userId) {
  const s = await activeSession(userId, 'crash');
  const user = await userById(userId);
  if (!s) return { ok: true, active: false, balance: Number(user?.balance || 0) };
  if (s.state?.funded === false) throw new Error('SESSION_STARTING');
  const elapsed = Date.now() - new Date(s.createdAt).getTime();
  const multiplier = Math.min(s.state.point, 1 + elapsed / 2500);
  if (multiplier >= s.state.point) {
    await updateSession(s.id, { ...s.state, crashedAt: Date.now() }, 'lost');
    await recordGame(userId, 'crash', s.state.bet, 0, { point: s.state.point, crashed: true }, 0, 'crash:' + s.id);
    return { ok: true, active: false, crashed: true, multiplier: s.state.point, balance: Number(user?.balance || 0) };
  }
  return { ok: true, active: true, phase: 'running', multiplier: Number(multiplier.toFixed(2)), balance: Number(user?.balance || 0) };
}
export async function crashCashout(userId) {
  const s = await activeSession(userId, 'crash');
  if (!s) throw new Error('NO_ACTIVE_CRASH');
  if (s.state?.funded === false) throw new Error('SESSION_STARTING');
  const status = await crashStatus(userId);
  if (!status.active) throw new Error('CRASHED');
  const payout = Math.floor(s.state.bet * status.multiplier);
  await credit(userId, payout, 'crash_win', { game: 'crash', multiplier: status.multiplier }, `crash-win:${s.id}`);
  await updateSession(s.id, { ...s.state, cashedOut: true, multiplier: status.multiplier }, 'settled');
  await recordGame(userId, 'crash', s.state.bet, payout, { multiplier: status.multiplier }, status.multiplier, 'crash:' + s.id);
  const user = await userById(userId);
  return { ok: true, cashedOut: true, multiplier: status.multiplier, payout, balance: Number(user?.balance || 0) };
}

function minesLayout(count = MINES_RULES.defaultMineCount, firstSafeIndex = null) {
  return generateMineLayout(count, firstSafeIndex);
}

function minesExpiryState(session) {
  return isMinesExpired(session?.state?.expiresAt, Date.now());
}

async function finalizeMinesSession(userId, session, reason = 'timeout') {
  if (!session || session.status !== 'active') {
    const user = await userById(userId);
    return { ok: true, active: false, expired: reason === 'timeout', balance: Number(user?.balance || 0) };
  }
  if (session.state?.funded === false) throw new Error('SESSION_STARTING');

  const state = session.state || {};
  const mineCount = Number.isSafeInteger(Number(state.mineCount))
    ? Number(state.mineCount)
    : (Array.isArray(state.mines) ? state.mines.length : MINES_RULES.defaultMineCount);
  const opened = Array.isArray(state.opened) ? state.opened : [];
  const multiplier = Number(state.multiplier || 1);
  const canCashout = canCashOutMines(opened.length, MINES_RULES);

  if (canCashout) {
    const rawPayout = Math.floor(Number(state.bet || 0) * multiplier);
    const treasury = await getTreasury();
    const ownerBalance = Math.max(0, Number(treasury?.ownerBalance || 0));
    const maxByCap = Math.floor(ownerBalance * MINES_RULES.capPercent);
    const maxByMultiplier = Math.floor(Number(state.bet || 0) * MINES_RULES.maxPayoutMultiplier);
    const payout = Math.max(0, Math.min(
      rawPayout,
      ownerBalance,
      maxByMultiplier,
      maxByCap > 0 ? maxByCap : ownerBalance,
    ));
    try {
      await credit(userId, payout, 'mines_win', {
        game: 'mines',
        multiplier,
        mineCount,
        opened: opened.length,
        reason,
        rawPayout,
      }, 'mines-win:' + session.id);
      await updateSession(session.id, { ...state, payout, settledReason: reason }, 'settled');
      await recordGame(userId, 'mines', Number(state.bet || 0), payout, {
        opened,
        mines: mineCount,
        reason,
      }, multiplier, 'mines:' + session.id);
      const user = await userById(userId);
      return { ok: true, active: false, expired: reason === 'timeout', payout, bet: Number(state.bet || 0), multiplier, balance: Number(user?.balance || 0) };
    } catch (error) {
      // If an eligible payout cannot be completed, refund the original wager
      // under a separate stable ledger key, as in the production game.
      await credit(userId, Number(state.bet || 0), 'mines_refund', {
        game: 'mines',
        reason: 'mines_payout_failed',
        sessionId: session.id,
      }, 'mines-refund:' + session.id);
      await updateSession(session.id, { ...state, refunded: true, settledReason: 'payout_failed' }, 'refunded');
      const user = await userById(userId);
      return { ok: true, active: false, expired: reason === 'timeout', refunded: true, payout: 0, bet: Number(state.bet || 0), multiplier, balance: Number(user?.balance || 0) };
    }
  }

  await credit(userId, Number(state.bet || 0), 'mines_refund', {
    game: 'mines',
    reason: reason === 'timeout' ? 'mines_timeout_before_cashout_unlock' : 'mines_cancel_before_cashout_unlock',
    sessionId: session.id,
    opened: opened.length,
  }, 'mines-refund:' + session.id);
  await updateSession(session.id, { ...state, refunded: true, settledReason: reason }, 'refunded');
  const user = await userById(userId);
  return { ok: true, active: false, expired: reason === 'timeout', refunded: true, payout: 0, bet: Number(state.bet || 0), balance: Number(user?.balance || 0) };
}

export async function minesStart(userId, amount, requestId = null, requestedMineCount = undefined) {
  const mineCount = normalizeMineCount(requestedMineCount);
  const existing = await activeSession(userId, 'mines');
  if (existing && minesExpiryState(existing)) {
    await finalizeMinesSession(userId, existing, 'timeout');
  }

  const startedAt = Date.now();
  const s = await startWagerSession(userId, 'mines', amount, requestId, (bet) => ({
    bet,
    mineCount,
    mines: null,
    opened: [],
    multiplier: 1,
    startedAt,
    expiresAt: minesExpiryTime(startedAt),
  }));
  const savedMineCount = Number.isSafeInteger(Number(s.state?.mineCount))
    ? Number(s.state.mineCount)
    : (Array.isArray(s.state?.mines) ? s.state.mines.length : mineCount);
  if (savedMineCount !== mineCount) throw new Error('MINES_ACTIVE');
  return {
    ok: true,
    sessionId: s.id,
    active: true,
    mineCount,
    opened: Array.isArray(s.state?.opened) ? s.state.opened : [],
    multiplier: Number(s.state?.multiplier || 1),
    expiresAt: Number(s.state?.expiresAt || minesExpiryTime(startedAt)),
    balance: Number((await userById(userId))?.balance || 0),
  };
}

export async function minesStatus(userId) {
  const s = await activeSession(userId, 'mines');
  const u = await userById(userId);
  if (!s) return { ok: true, active: false, balance: Number(u?.balance || 0) };
  if (s.state?.funded === false) throw new Error('SESSION_STARTING');
  if (minesExpiryState(s)) return finalizeMinesSession(userId, s, 'timeout');
  return {
    ok: true,
    active: true,
    sessionId: s.id,
    mineCount: Number(s.state?.mineCount || (Array.isArray(s.state?.mines) ? s.state.mines.length : MINES_RULES.defaultMineCount)),
    opened: Array.isArray(s.state?.opened) ? s.state.opened : [],
    multiplier: Number(s.state?.multiplier || 1),
    cashoutAvailable: canCashOutMines((s.state?.opened || []).length),
    expiresAt: Number(s.state?.expiresAt || 0) || null,
    balance: Number(u?.balance || 0),
  };
}

export async function minesOpen(userId, index) {
  const s = await activeSession(userId, 'mines');
  if (!s) throw new Error('NO_ACTIVE_MINES');
  if (s.state?.funded === false) throw new Error('SESSION_STARTING');
  if (minesExpiryState(s)) return finalizeMinesSession(userId, s, 'timeout');

  const cell = Number(index);
  if (!Number.isInteger(cell) || cell < 0 || cell >= MINES_RULES.boardSize ** 2) {
    throw new Error('INVALID_TILE');
  }
  const state = s.state || {};
  const openedBefore = Array.isArray(state.opened) ? state.opened : [];
  if (openedBefore.includes(cell)) throw new Error('TILE_OPENED');

  const mineCount = Number.isSafeInteger(Number(state.mineCount))
    ? Number(state.mineCount)
    : (Array.isArray(state.mines) ? state.mines.length : MINES_RULES.defaultMineCount);
  // Delay mine layout until the first pick so that the selected cell is
  // excluded from mines, matching the main branch's first-safe protection.
  const mines = Array.isArray(state.mines)
    ? state.mines
    : minesLayout(mineCount, openedBefore.length === 0 ? cell : null);

  if (mines.includes(cell)) {
    await updateSession(s.id, { ...state, mines, hitMine: cell }, 'lost');
    await recordGame(userId, 'mines', Number(state.bet || 0), 0, {
      mine: cell,
      mines: mineCount,
      opened: openedBefore,
    }, 0, 'mines:' + s.id);
    return {
      ok: true,
      active: false,
      exploded: true,
      mine: cell,
      bet: Number(state.bet || 0),
      multiplier: 0,
      payout: 0,
      balance: Number((await userById(userId))?.balance || 0),
    };
  }

  const opened = [...openedBefore, cell];
  const multiplier = calculateMinesMultiplier(opened.length, mineCount);
  const expiresAt = Number(state.expiresAt || minesExpiryTime(state.startedAt || Date.now()));
  const allSafeOpened = opened.length >= (MINES_RULES.boardSize ** 2) - mineCount;
  await updateSession(s.id, { ...state, mines, mineCount, opened, multiplier, expiresAt, startedAt: state.startedAt || Date.now() });
  if (allSafeOpened) return finalizeMinesSession(userId, {
    ...s,
    state: { ...state, mines, mineCount, opened, multiplier, expiresAt },
  }, 'perfect_clear');
  return {
    ok: true,
    active: true,
    opened,
    mineCount,
    multiplier,
    cashoutAvailable: canCashOutMines(opened.length),
    expiresAt,
    balance: Number((await userById(userId))?.balance || 0),
  };
}

export async function minesCashout(userId) {
  const s = await activeSession(userId, 'mines');
  if (!s) throw new Error('NO_ACTIVE_MINES');
  if (s.state?.funded === false) throw new Error('SESSION_STARTING');
  if (minesExpiryState(s)) return finalizeMinesSession(userId, s, 'timeout');
  const opened = Array.isArray(s.state?.opened) ? s.state.opened : [];
  if (!canCashOutMines(opened.length)) throw new Error('MINES_CASHOUT_LOCKED');
  return finalizeMinesSession(userId, s, 'cashout');
}

function deck() {
  return createBlackjackDeck();
}

function blackjackRoomId(value) {
  return normalizeBlackjackRoom(value);
}

function blackjackPlayerResult(state, player) {
  return resultForBlackjack(player.cards, state.dealer);
}

function blackjackExpiry(session) {
  return Number(session?.state?.expiresAt || 0) > 0 && Number(session.state.expiresAt) <= Date.now();
}

async function updateBlackjackSession(session, state, status = 'active') {
  const version = Number(session.version || 0);
  const result = await db.update(gameSessions)
    .set({ state, status, version: version + 1, updatedAt: now(), expiresAt: state.expiresAt ? new Date(state.expiresAt) : null })
    .where(and(
      eq(gameSessions.id, session.id),
      eq(gameSessions.version, version),
      eq(gameSessions.status, session.status),
    ))
    .run();
  const changed = Number(result?.rowsAffected ?? result?.changes ?? (Array.isArray(result) ? result.length : 0));
  if (changed !== 1) throw new Error('BJ_SESSION_CHANGED');
  return db.select().from(gameSessions).where(eq(gameSessions.id, session.id)).get();
}

async function getBlackjackSession(roomId) {
  const id = blackjackRoomId(roomId);
  return db.select().from(gameSessions).where(eq(gameSessions.id, 'bj:' + id)).get();
}

async function settleBlackjackSession(roomId, state, reason) {
  const sessionId = 'bj:' + roomId;
  const plan = Array.isArray(state.settlementPlan)
    ? state.settlementPlan
    : buildBlackjackSettlementPlan(state.players || [], state.dealer || [], reason, state.rtpWinRate);
  // Store immutable outcomes before ledger writes. On retry, each per-player
  // idempotency key makes a partial settlement resumable without double payout.
  const settling = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).get();
  if (settling && settling.status === 'active') {
    await updateBlackjackSession(settling, { ...state, settlementPlan: plan, settleReason: reason, settlingAt: Date.now() }, 'settling');
  }
  for (const entry of plan) {
    const keyBase = 'blackjack:' + roomId + ':' + entry.userId;
    if (reason === 'timeout' || entry.result === 'REFUND') {
      await credit(entry.userId, entry.bet, 'blackjack_refund', {
        game: 'blackjack', roomId, playerId: entry.userId, reason,
      }, 'bj-refund:' + keyBase);
    } else if (entry.payout > 0) {
      await credit(entry.userId, entry.payout, 'blackjack_win', {
        game: 'blackjack', roomId, playerId: entry.userId,
        result: entry.result, natural: entry.natural, reason,
      }, 'bj-payout:' + keyBase);
    }
    await recordGame(entry.userId, 'blackjack', entry.bet, entry.payout, {
      player: entry.playerValue, dealer: blackjackCardValue(state.dealer),
      result: entry.result, natural: entry.natural, reason,
    }, entry.bet ? entry.payout / entry.bet : 0, 'blackjack-history:' + keyBase);
  }
  const latest = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).get();
  if (latest && latest.status !== 'settled') {
    await updateBlackjackSession(latest, { ...state, settlementPlan: plan, settleReason: reason, settledAt: Date.now() }, 'settled');
  }
  return { ok: true, active: false, settled: true, roomId, settlementPlan: plan, balanceByUser: null };
}

export async function blackjackJoin(userId, roomId = 'solo', amount, requestId = null) {
  await ensureEconomy();
  const room = blackjackRoomId(roomId);
  const user = Number(userId);
  const bet = validBet(amount, BLACKJACK_RULES.minBet, BLACKJACK_RULES.maxBet);
  const sessionId = 'bj:' + room;
  let session = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).get();

  if (!session) {
    await consumeCooldown(user, 'blackjack', BLACKJACK_RULES.cooldownMs);
    const rtpWinRate = clampBlackjackRtp(await getSetting('blackjack_rtp', BLACKJACK_RULES.defaultRtp));
    const cards = deck();
    const state = {
      roomId: room,
      players: [],
      dealer: [cards.pop(), cards.pop()],
      deck: cards,
      startedAt: Date.now(),
      expiresAt: Date.now() + BLACKJACK_RULES.actionTimeoutMs,
      actionTimeoutMs: BLACKJACK_RULES.actionTimeoutMs,
      rtpWinRate,
      requestId: String(requestId || '').trim().slice(0, 120) || null,
    };
    state.players.push({ id: user, bet, cards: [state.deck.pop(), state.deck.pop()], stood: false });
    const nowAt = now();
    try {
      await db.insert(gameSessions).values({
        id: sessionId, userId: user, game: 'blackjack', status: 'active', state,
        roomId: room, expiresAt: new Date(state.expiresAt), version: 0,
        createdAt: nowAt, updatedAt: nowAt,
      }).run();
    } catch (error) {
      session = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).get();
      if (!session) throw error;
      const existingState = session.state || {};
      if ((existingState.players || []).some((player) => Number(player.id) === user)) return blackjackStatus(user, room);
      throw new Error('BJ_ROOM_ALREADY_STARTED');
    }
    try {
      await debit(user, bet, 'blackjack_bet', { game: 'blackjack', roomId: room }, 'bj-bet:' + sessionId + ':' + user);
    } catch (error) {
      const latest = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).get();
      if (latest?.status === 'active') {
        await updateBlackjackSession(latest, { ...latest.state, setupError: true }, 'cancelled');
      }
      throw error;
    }
    const latest = await db.select().from(gameSessions).where(eq(gameSessions.id, sessionId)).get();
    if (latest?.status === 'active') {
      await updateBlackjackSession(latest, { ...latest.state, funded: true }, 'active');
    }
    return blackjackStatus(user, room);
  }

  if (session.status !== 'active') throw new Error('BJ_ROOM_CLOSED');
  const state = session.state || {};
  if ((state.players || []).some((player) => Number(player.id) === user)) return blackjackStatus(user, room);
  if ((state.players || []).length >= BLACKJACK_RULES.maxPlayers) throw new Error('BJ_TABLE_FULL');
  if (blackjackExpiry(session)) {
    await settleBlackjackSession(room, state, 'timeout');
    throw new Error('BJ_ROOM_EXPIRED');
  }
  await consumeCooldown(user, 'blackjack', BLACKJACK_RULES.cooldownMs);
  const latest = await getBlackjackSession(room);
  if (!latest || latest.status !== 'active' || Number(latest.version || 0) !== Number(session.version || 0)) {
    throw new Error('BJ_SESSION_CHANGED');
  }
  const latestState = latest.state || {};
  if ((latestState.players || []).some((player) => Number(player.id) === user)) return blackjackStatus(user, room);
  if ((latestState.players || []).length >= BLACKJACK_RULES.maxPlayers) throw new Error('BJ_TABLE_FULL');
  await debit(user, bet, 'blackjack_bet', { game: 'blackjack', roomId: room }, 'bj-bet:' + sessionId + ':' + user);
  const nextState = {
    ...latestState,
    players: [...latestState.players, { id: user, bet, cards: [latestState.deck.pop(), latestState.deck.pop()], stood: false }],
  };
  await updateBlackjackSession(latest, nextState, 'active');
  return blackjackStatus(user, room);
}

export async function blackjackStatus(userId, roomId = 'solo') {
  const room = blackjackRoomId(roomId);
  const session = await getBlackjackSession(room);
  if (!session) return { ok: true, roomId: room, active: false, player: null };
  let state = session.state || {};
  if (session.status === 'active' && blackjackExpiry(session)) {
    await settleBlackjackSession(room, state, 'timeout');
    const user = await userById(userId);
    return { ok: true, roomId: room, active: false, expired: true, player: (state.players || []).find((p) => Number(p.id) === Number(userId)) || null, balance: Number(user?.balance || 0) };
  }
  if (session.status === 'settling') {
    await settleBlackjackSession(room, state, state.settleReason || 'stand');
    const refreshed = await getBlackjackSession(room);
    state = refreshed?.state || state;
  }
  const player = (state.players || []).find((p) => Number(p.id) === Number(userId)) || null;
  return {
    ok: true,
    roomId: room,
    active: session.status === 'active',
    player,
    dealer: player ? (state.dealer || []).map((card, index) => index === 0 ? card : { r: '?', s: '?' }) : [],
    players: (state.players || []).map((p) => ({ id: p.id, bet: p.bet, value: blackjackCardValue(p.cards), stood: !!p.stood })),
    expiresAt: Number(state.expiresAt || 0) || null,
    actionTimeoutMs: Number(state.actionTimeoutMs || BLACKJACK_RULES.actionTimeoutMs),
    settlementPlan: state.settlementPlan || null,
  };
}

export async function blackjackAction(userId, roomId, action) {
  const room = blackjackRoomId(roomId);
  const user = Number(userId);
  if (!['hit', 'stand'].includes(action)) throw new Error('BJ_NOT_PLAYING');
  const session = await getBlackjackSession(room);
  if (!session || session.status !== 'active') throw new Error('BJ_ROOM_NOT_ACTIVE');
  const state = session.state || {};
  if (blackjackExpiry(session)) {
    await settleBlackjackSession(room, state, 'timeout');
    throw new Error('BJ_ROOM_EXPIRED');
  }
  const playerIndex = (state.players || []).findIndex((player) => Number(player.id) === user);
  if (playerIndex < 0) throw new Error('BJ_NOT_JOINED');
  const player = state.players[playerIndex];
  if (player.stood || blackjackCardValue(player.cards) > 21) throw new Error('BJ_ACTION_ALREADY_DONE');

  const nextState = {
    ...state,
    players: state.players.map((entry, index) => index === playerIndex ? { ...entry, cards: [...entry.cards] } : { ...entry }),
    deck: [...(state.deck || [])],
  };
  const nextPlayer = nextState.players[playerIndex];
  if (action === 'hit') {
    const drawn = nextState.deck.pop();
    if (!drawn) throw new Error('BJ_DECK_EMPTY');
    nextPlayer.cards.push(drawn);
    if (blackjackCardValue(nextPlayer.cards) > 21) {
      nextPlayer.stood = true;
      nextPlayer.finalResult = 'LOSE';
    }
  } else {
    nextPlayer.stood = true;
  }

  if (nextState.players.every((entry) => entry.stood || entry.finalResult)) {
    // Dealer draws once, then each player's immutable result/payout plan is saved.
    while (blackjackCardValue(nextState.dealer) < 17 && nextState.deck.length) {
      nextState.dealer.push(nextState.deck.pop());
    }
    nextState.settlementPlan = buildBlackjackSettlementPlan(
      nextState.players,
      nextState.dealer,
      'actions_complete',
      nextState.rtpWinRate,
    );
    nextState.players = nextState.players.map((entry, index) => ({
      ...entry,
      finalResult: nextState.settlementPlan[index].result,
      natural: nextState.settlementPlan[index].natural,
    }));
    nextState.settleReason = 'actions_complete';
    await updateBlackjackSession(session, nextState, 'settling');
    await settleBlackjackSession(room, nextState, 'actions_complete');
  } else {
    await updateBlackjackSession(session, nextState, 'active');
  }
  return blackjackStatus(user, room);
}

function shanCards() { const d=deck(); return [d.pop(),d.pop(),d.pop()]; }
export async function shanCreate(userId,title='Bika Shan Koe Mee Pro Table') { const id=`shan:${uid()}`; await db.insert(gameSessions).values({id,userId:Number(userId),game:'shan',status:'waiting',state:{title,players:[]},createdAt:now(),updatedAt:now()}).run(); return {ok:true,roomId:id.replace(/^shan:/,''),title}; }
export async function shanJoin(userId,roomId,amount){const id=`shan:${String(roomId||'').replace(/^shan:/,'')}`;const s=await db.select().from(gameSessions).where(eq(gameSessions.id,id)).get();if(!s)throw new Error('SHAN_ROOM_NOT_FOUND');const st=s.state||{};if(st.players.some(p=>p.id===Number(userId)))return shanStatus(userId,roomId);if(st.players.length>=6)throw new Error('SHAN_TABLE_FULL');const bet=betOf(amount);await debit(userId,bet,'shan_bet',{game:'shan',roomId},`shan:${id}:${userId}`);st.players.push({id:Number(userId),bet,cards:[]});await updateSession(id,st,'waiting');return shanStatus(userId,roomId);}
export async function shanStatus(userId,roomId){const id=`shan:${String(roomId||'').replace(/^shan:/,'')}`;const s=await db.select().from(gameSessions).where(eq(gameSessions.id,id)).get();if(!s)return {ok:true,active:false};const me=(s.state?.players||[]).find(p=>p.id===Number(userId));return {ok:true,active:s.status!=='settled',roomId:String(roomId||''),title:s.state.title,players:(s.state.players||[]).map(p=>({id:p.id,bet:p.bet,cards:p.cards,value:cardValue(p.cards)})),player:me||null};}
export async function shanDeal(userId,roomId,action='deal'){const id=`shan:${String(roomId||'').replace(/^shan:/,'')}`;const s=await db.select().from(gameSessions).where(eq(gameSessions.id,id)).get();if(!s)throw new Error('SHAN_ROOM_NOT_FOUND');const st=s.state||{};const me=st.players.find(p=>p.id===Number(userId));if(!me)throw new Error('SHAN_NOT_JOINED');if(action==='draw'&&me.cards.length<3)me.cards.push(...shanCards().slice(0,1));else if(action==='deal'&&!me.cards.length)me.cards=shanCards();else if(action==='stay')me.stayed=true;else if(action==='draw'&&me.cards.length>=3)throw new Error('SHAN_MAX_CARDS');if(st.players.every(p=>p.stayed||p.cards.length>=3)){const max=Math.max(...st.players.map(p=>cardValue(p.cards)));for(const p of st.players){const payout=cardValue(p.cards)===max?Math.floor(p.bet*2):0;if(payout)await credit(p.id,payout,'shan_win',{game:'shan',roomId},`shan-win:${id}:${p.id}`);await recordGame(p.id,'shan',p.bet,payout,{value:cardValue(p.cards)},payout/p.bet,'shan:'+id+':'+p.id);}await updateSession(id,st,'settled');}else await updateSession(id,st);return shanStatus(userId,roomId);}

export async function config() {
  return {
    ok: true,
    coin: '$',
    games: ['crash', 'slot', 'blackjack', 'shan', 'plinko', 'wheel', 'mines'],
    serverless: true,
    productionDataImported: false,
    liveEconomyEnabled: false,
    productionCutoverApproved: false,
  };
}
