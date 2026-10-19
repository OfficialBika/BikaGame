import { db, EndpointError } from 'sdk';
import { and, desc, eq, gte, sql } from 'sdk/db';
import { gameHistory, gameSessions, users } from '../schema.js';
import { ensureEconomy, ensureUser, userById as accountUserById, debit as ledgerDebit, credit as ledgerCredit, settleSingleGame, settleAward, getTreasury, getSetting, consumeCooldown, getTransaction, hasIdempotencyKey, recordGame as ledgerRecordGame } from './economy.js';
import { spin as slotSpinEngine, multiplier as slotMultiplier, art as slotArt } from './slotEngine.js';

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
export async function playSlot(userId, amount, spinId = null) {
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
  const rtp = Number(await getSetting('web_game_rtp_slot', 65));
  const house = await getTreasury();
  const reels = slotSpinEngine(user, Number(house?.vipWinRate ?? 90), Math.random, rtp);
  const multiplier = Number(slotMultiplier(reels)) || 0;
  const rawPayout = Math.floor(bet * multiplier);
  const payout = await capPayout(bet, rawPayout, 0.30, 999999999, true);
  const meta = { source: 'miniapp', title: reels.join(' '), outcome: payout > bet ? 'win' : payout > 0 ? 'paid' : 'lose', reels, rawPayout, multiplier, rtp, vip: !!user.isVip };
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
  const user = await recordGame(userId, 'crash', s.state.bet, payout, { multiplier: status.multiplier }, status.multiplier, 'crash:' + s.id);
  return { ok: true, cashedOut: true, multiplier: status.multiplier, payout, balance: user.balance };
}

function minesLayout(count = 3) { const set = new Set(); while (set.size < count) set.add(Math.floor(Math.random() * 25)); return [...set]; }
export async function minesStart(userId, amount, requestId = null) {
  const s = await startWagerSession(userId, 'mines', amount, requestId, (bet) => ({
    bet, mines: minesLayout(3), opened: [], multiplier: 1,
  }));
  return { ok: true, sessionId: s.id, active: true, opened: [], multiplier: 1, balance: (await userById(userId)).balance };
}
export async function minesStatus(userId) { const s = await activeSession(userId, 'mines'); const u = await userById(userId); return s ? { ok:true, active:true, opened:s.state.opened, multiplier:s.state.multiplier, balance:u.balance } : { ok:true, active:false, balance:u?.balance||0 }; }
export async function minesOpen(userId, index) {
  const s = await activeSession(userId, 'mines'); if (!s) throw new Error('NO_ACTIVE_MINES');
  if (s.state?.funded === false) throw new Error('SESSION_STARTING');
  const i = Math.floor(n(index, -1)); if (i < 0 || i >= 25) throw new Error('INVALID_TILE');
  if (s.state.opened.includes(i)) throw new Error('TILE_OPENED');
  if (s.state.mines.includes(i)) { await updateSession(s.id, { ...s.state, hitMine:i }, 'lost'); await recordGame(userId,'mines',s.state.bet,0,{mine:i},0,'mines:'+s.id); return { ok:true, active:false, mine:i, exploded:true, payout:0, balance:(await userById(userId)).balance }; }
  const opened = [...s.state.opened, i]; const multiplier = Number((1 + opened.length * 0.35).toFixed(2));
  await updateSession(s.id, { ...s.state, opened, multiplier });
  return { ok:true, active:true, opened, multiplier, balance:(await userById(userId)).balance };
}
export async function minesCashout(userId) {
  const s = await activeSession(userId, 'mines'); if (!s) throw new Error('NO_ACTIVE_MINES');
  if (s.state?.funded === false) throw new Error('SESSION_STARTING');
  if (!s.state.opened.length) throw new Error('MINES_CASHOUT_LOCKED');
  const payout = Math.floor(s.state.bet * s.state.multiplier); await credit(userId,payout,'mines_win',{game:'mines',multiplier:s.state.multiplier},`mines-win:${s.id}`);
  await updateSession(s.id,{...s.state,payout},'settled'); const u=await recordGame(userId,'mines',s.state.bet,payout,{opened:s.state.opened},s.state.multiplier,'mines:'+s.id);
  return {ok:true,active:false,payout,multiplier:s.state.multiplier,balance:u.balance};
}

function deck() { const suits=['♠','♥','♦','♣']; const ranks=['A','2','3','4','5','6','7','8','9','10','J','Q','K']; return suits.flatMap(s=>ranks.map(r=>({r,s}))).sort(()=>Math.random()-0.5); }
function cardValue(cards) { let total=0, aces=0; for(const c of cards){ if(c.r==='A'){total+=11;aces++;} else total += ['K','Q','J'].includes(c.r)?10:Number(c.r); } while(total>21&&aces--) total-=10; return total; }
export async function blackjackJoin(userId, roomId, amount) {
  const id = String(roomId || 'solo'); const existing = await db.select().from(gameSessions).where(eq(gameSessions.id, `bj:${id}`)).get();
  const bet=betOf(amount);
  if (!existing) { await debit(userId,bet,'blackjack_bet',{game:'blackjack',room:id},`bj:${id}:${userId}`); const d=deck(); const state={players:[{id:Number(userId),bet,cards:[d.pop(),d.pop()]}],dealer:[d.pop(),d.pop()],deck:d,started:true}; await db.insert(gameSessions).values({id:`bj:${id}`,userId:Number(userId),game:'blackjack',status:'active',state,createdAt:now(),updatedAt:now()}).run(); return blackjackStatus(userId,id); }
  const state=existing.state||{}; if(state.players.some(p=>p.id===Number(userId))) return blackjackStatus(userId,id); if(state.players.length>=5) throw new Error('BJ_TABLE_FULL'); await debit(userId,bet,'blackjack_bet',{game:'blackjack',room:id},`bj:${id}:${userId}`); state.players.push({id:Number(userId),bet,cards:[state.deck.pop(),state.deck.pop()]}); await updateSession(existing.id,state); return blackjackStatus(userId,id);
}
export async function blackjackStatus(userId, roomId) { const s=await db.select().from(gameSessions).where(eq(gameSessions.id,`bj:${String(roomId||'solo')}`)).get(); if(!s) return {ok:true,roomId:String(roomId||'solo'),active:false}; const me=s.state.players.find(p=>p.id===Number(userId)); return {ok:true,roomId:String(roomId||'solo'),active:s.status==='active',player:me||null,dealer:s.state.dealer.map((c,i)=>i===0&&s.state.players.some(p=>p.id===Number(userId))?c:{r:'?',s:'?'}),players:s.state.players.map(p=>({id:p.id,value:cardValue(p.cards)}))}; }
export async function blackjackAction(userId, roomId, action) { const s=await db.select().from(gameSessions).where(eq(gameSessions.id,`bj:${String(roomId||'solo')}`)).get(); if(!s) throw new Error('BJ_ROOM_NOT_FOUND'); const st=s.state; const me=st.players.find(p=>p.id===Number(userId)); if(!me) throw new Error('BJ_NOT_JOINED'); if(action==='hit'){me.cards.push(st.deck.pop()); if(cardValue(me.cards)>21) action='stand';} if(action==='stand'){me.stood=true;} if(!['hit','stand'].includes(action)) throw new Error('BJ_NOT_PLAYING'); if(st.players.every(p=>p.stood||cardValue(p.cards)>21)){while(cardValue(st.dealer)<17) st.dealer.push(st.deck.pop()); for(const p of st.players){const pv=cardValue(p.cards), dv=cardValue(st.dealer); let payout=0; if(pv<=21&&(dv>21||pv>dv)) payout=Math.floor(p.bet*2); else if(pv===dv) payout=p.bet; if(payout) await credit(p.id,payout,'blackjack_win',{game:'blackjack',roomId},`bj-win:${s.id}:${p.id}`); await recordGame(p.id,'blackjack',p.bet,payout,{player:pv,dealer:dv},payout/p.bet,'blackjack:'+s.id+':'+p.id);} await updateSession(s.id,st,'settled');} else await updateSession(s.id,st); return blackjackStatus(userId,roomId); }

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
