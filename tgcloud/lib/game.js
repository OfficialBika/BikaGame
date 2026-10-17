import { db } from 'sdk';
import { and, desc, eq, gte, isNull, lt, or, sql } from 'sdk/db';
import { gameHistory, gameSessions, transactions, users } from '../schema.js';

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
  return db.select().from(users).where(eq(users.tgId, Number(userId))).get();
}

export async function ensurePreviewUser(tgUser) {
  const id = Number(tgUser?.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('INVALID_TELEGRAM_USER_ID');
  const t = now();
  await db.insert(users).values({
    tgId: id,
    username: tgUser.username || null,
    firstName: tgUser.first_name || 'Player',
    lastName: tgUser.last_name || null,
    photoUrl: tgUser.photo_url || null,
    languageCode: tgUser.language_code || null,
    balance: 0,
    totalWon: 0,
    totalLost: 0,
    isVip: false,
    startBonusClaimed: false,
    dailyClaimedAt: null,
    startedBot: true,
    createdAt: t,
    updatedAt: t,
  }).onConflictDoUpdate({
    target: users.tgId,
    set: { username: tgUser.username || null, firstName: tgUser.first_name || 'Player', lastName: tgUser.last_name || null, photoUrl: tgUser.photo_url || null, languageCode: tgUser.language_code || null, startedBot: true, updatedAt: t },
  }).run();
  return userById(id);
}

async function changeBalance(userId, delta, type, meta = {}, key = uid()) {
  const amount = Math.floor(n(delta));
  if (!Number.isSafeInteger(amount) || amount === 0) return userById(userId);
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) throw new Error('INVALID_USER');
  if (typeof key !== 'string' || !key || key.length > 200) throw new Error('IDEMPOTENCY_KEY_REQUIRED');

  const id = Number(userId);
  const existing = await db.select().from(transactions)
    .where(eq(transactions.idempotencyKey, key)).get();
  if (existing) {
    if (existing.type !== type || Number(existing.amount) !== Math.abs(amount)) {
      throw new Error('IDEMPOTENCY_KEY_CONFLICT');
    }
    return userById(id);
  }

  const t = now();
  const changes = {
    balance: sql`${users.balance} + ${amount}`,
    updatedAt: t,
  };
  if (amount > 0) changes.totalWon = sql`${users.totalWon} + ${amount}`;
  if (amount < 0) changes.totalLost = sql`${users.totalLost} + ${Math.abs(amount)}`;

  const where = amount < 0
    ? and(eq(users.tgId, id), gte(users.balance, Math.abs(amount)))
    : eq(users.tgId, id);
  const updated = await db.update(users).set(changes).where(where).run();
  if (!updated?.rowsAffected) {
    const current = await userById(id);
    if (!current) throw new Error('USER_NOT_FOUND');
    if (amount < 0) throw new Error('USER_INSUFFICIENT');
    throw new Error('BALANCE_UPDATE_FAILED');
  }

  await db.insert(transactions).values({
    type,
    fromUserId: amount < 0 ? String(id) : null,
    toUserId: amount > 0 ? String(id) : null,
    amount: Math.abs(amount),
    idempotencyKey: key,
    meta,
    createdAt: t,
  }).run();
  return userById(id);
}

export async function debit(userId, amount, type = 'bet', meta = {}, key) {
  return changeBalance(userId, -betOf(amount), type, meta, key);
}

export async function credit(userId, amount, type = 'win', meta = {}, key) {
  return changeBalance(userId, Math.max(0, Math.floor(n(amount))), type, meta, key);
}

export async function recordGame(userId, game, bet, payout, result, multiplier = 0) {
  await db.insert(gameHistory).values({ userId: Number(userId), game, bet: Math.floor(n(bet)), payout: Math.floor(n(payout)), multiplier: Math.floor(n(multiplier)), result, createdAt: now() }).run();
  return userById(userId);
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

async function createSession(userId, game, state) {
  const t = now();
  const id = uid();
  await db.insert(gameSessions).values({ id, userId: Number(userId), game, status: 'active', state, createdAt: t, updatedAt: t }).run();
  return db.select().from(gameSessions).where(eq(gameSessions.id, id)).get();
}

async function updateSession(id, state, status = 'active') {
  await db.update(gameSessions).set({ state, status, updatedAt: now() }).where(eq(gameSessions.id, id)).run();
  return db.select().from(gameSessions).where(eq(gameSessions.id, id)).get();
}

async function settleSession(id, status) {
  const result = await db.update(gameSessions).set({ status, updatedAt: now() })
    .where(and(eq(gameSessions.id, id), eq(gameSessions.status, 'active'))).run();
  return Boolean(result?.rowsAffected);
}

function weighted(items) {
  const total = items.reduce((a, x) => a + x.w, 0);
  let r = Math.random() * total;
  for (const x of items) { r -= x.w; if (r < 0) return x.v; }
  return items[items.length - 1].v;
}

const slotSymbols = ['🍒','🍋','🍉','🔔','⭐','BAR','7'];
const slotPays = { '7,7,7':20, 'BAR,BAR,BAR':15, '⭐,⭐,⭐':12, '🔔,🔔,🔔':9, '🍉,🍉,🍉':7, '🍋,🍋,🍋':5, '🍒,🍒,🍒':3 };
function slotSpin() {
  const reels = [0,1,2].map(() => weighted(slotSymbols.map((v, i) => ({ v, w: [3200,2200,1500,900,450,200,100][i] }))));
  const key = reels.join(',');
  let multiplier = slotPays[key] || 0;
  if (!multiplier && new Set(reels).size === 2) multiplier = 1.5;
  return { reels, multiplier, payoutMultiplier: multiplier };
}

export async function playSlot(userId, amount) {
  const bet = betOf(amount);
  await debit(userId, bet, 'slot_bet', { game: 'slot' }, `slot:${userId}:${uid()}`);
  const result = slotSpin();
  const payout = Math.floor(bet * result.multiplier);
  if (payout) await credit(userId, payout, 'slot_win', { game: 'slot', reels: result.reels }, `slot-win:${userId}:${uid()}`);
  const user = await recordGame(userId, 'slot', bet, payout, result.reels, result.multiplier);
  return { ok: true, game: 'slot', reels: result.reels, multiplier: result.multiplier, payout, balance: user.balance };
}

export async function playPlinko(userId, amount) {
  const bet = betOf(amount);
  await debit(userId, bet, 'plinko_bet', { game: 'plinko' }, `plinko:${userId}:${uid()}`);
  const multipliers = [0,0.5,0.8,1,1.2,1.5,2,3,5,10];
  const multiplier = weighted(multipliers.map((v) => ({ v, w: v === 0 ? 12 : v >= 5 ? 1 : 8 })));
  const payout = Math.floor(bet * multiplier);
  if (payout) await credit(userId, payout, 'plinko_win', { game: 'plinko', multiplier }, `plinko-win:${userId}:${uid()}`);
  const user = await recordGame(userId, 'plinko', bet, payout, { multiplier }, multiplier);
  return { ok: true, game: 'plinko', multiplier, payout, balance: user.balance };
}

const wheelSegments = [0, 50, 100, 250, 500, 1000, 2500, 5000];
export async function wheelSpin(userId, amount) {
  const bet = betOf(amount);
  await debit(userId, bet, 'wheel_bet', { game: 'wheel' }, `wheel:${userId}:${uid()}`);
  const reward = weighted(wheelSegments.map((v) => ({ v, w: v >= 2500 ? 1 : 6 })));
  const payout = Math.floor(bet * reward / 100);
  if (payout) await credit(userId, payout, 'wheel_win', { game: 'wheel', reward }, `wheel-win:${userId}:${uid()}`);
  const user = await recordGame(userId, 'wheel', bet, payout, { reward }, reward);
  return { ok: true, game: 'wheel', reward, payout, balance: user.balance, segments: wheelSegments };
}

export async function dailyWheel(userId) {
  const id = Number(userId);
  const existing = await userById(id);
  if (!existing) throw new Error('USER_NOT_FOUND');

  const t = now();
  const today = t.toISOString().slice(0, 10);
  const startOfToday = new Date(today + 'T00:00:00.000Z');
  const reward = weighted([50,100,250,500,1000].map((v) => ({ v, w: v === 1000 ? 1 : 5 })));

  // Single conditional UPDATE provides a compare-and-set claim guard. Concurrent
  // requests for the same user/date cannot both receive the daily reward.
  const claim = await db.update(users)
    .set({
      balance: sql`${users.balance} + ${reward}`,
      dailyClaimedAt: t,
      updatedAt: t,
    })
    .where(and(
      eq(users.tgId, id),
      or(isNull(users.dailyClaimedAt), lt(users.dailyClaimedAt, startOfToday)),
    ))
    .returning()
    .run();
  const updated = Array.isArray(claim) ? claim[0] : null;
  if (!updated) {
    const current = await userById(id);
    if (!current) throw new Error('USER_NOT_FOUND');
    throw new Error('WHEEL_DAILY_USED');
  }

  // The preview ledger/history is retained for audit visibility. Live payouts
  // are not enabled: the platform path needs a verified all-or-nothing write.
  await db.insert(transactions).values({
    type: 'daily_reward',
    fromUserId: null,
    toUserId: String(id),
    amount: reward,
    idempotencyKey: 'daily:' + id + ':' + today,
    meta: { game: 'wheel' },
    createdAt: t,
  }).onConflictDoNothing().run();
  await recordGame(id, 'wheel_daily', 0, reward, { reward }, reward);
  return { ok: true, reward, balance: updated.balance, claimed: true, date: today };
}

function crashPoint() { return Math.max(1.01, Math.floor((1.01 + Math.random() * Math.random() * 7) * 100) / 100); }
export async function crashStart(userId, amount) {
  const bet = betOf(amount);
  if (await activeSession(userId, 'crash')) throw new Error('CRASH_RUNNING');
  await debit(userId, bet, 'crash_bet', { game: 'crash' }, `crash:${userId}:${uid()}`);
  const session = await createSession(userId, 'crash', { bet, point: crashPoint(), startedAt: Date.now(), cashedOut: false });
  return { ok: true, sessionId: session.id, phase: 'running', multiplier: 1, balance: (await userById(userId)).balance };
}
export async function crashStatus(userId) {
  const s = await activeSession(userId, 'crash');
  const user = await userById(userId);
  if (!s) return { ok: true, active: false, balance: Number(user?.balance || 0) };
  const elapsed = Date.now() - new Date(s.createdAt).getTime();
  const multiplier = Math.min(s.state.point, 1 + elapsed / 2500);
  if (multiplier >= s.state.point) {
    const settled = await db.update(gameSessions)
      .set({ state: { ...s.state, crashedAt: Date.now() }, status: 'lost', updatedAt: now() })
      .where(and(eq(gameSessions.id, s.id), eq(gameSessions.status, 'active'))).run();
    if (settled?.rowsAffected) {
      await recordGame(userId, 'crash', s.state.bet, 0, { point: s.state.point, crashed: true }, 0);
    }
    return { ok: true, active: false, crashed: true, multiplier: s.state.point, balance: Number((await userById(userId))?.balance || 0) };
  }
  return { ok: true, active: true, phase: 'running', multiplier: Number(multiplier.toFixed(2)), balance: Number(user?.balance || 0) };
}
export async function crashCashout(userId) {
  const s = await activeSession(userId, 'crash');
  if (!s) throw new Error('NO_ACTIVE_CRASH');
  const status = await crashStatus(userId);
  if (!status.active) throw new Error('CRASHED');
  const payout = Math.floor(s.state.bet * status.multiplier);
  if (!(await settleSession(s.id, 'settled'))) throw new Error('CRASH_ALREADY_SETTLED');
  await credit(userId, payout, 'crash_win', { game: 'crash', multiplier: status.multiplier }, `crash-win:${s.id}`);
  const user = await recordGame(userId, 'crash', s.state.bet, payout, { multiplier: status.multiplier }, status.multiplier);
  return { ok: true, cashedOut: true, multiplier: status.multiplier, payout, balance: user.balance };
}

function minesLayout(count = 3) { const set = new Set(); while (set.size < count) set.add(Math.floor(Math.random() * 25)); return [...set]; }
export async function minesStart(userId, amount) {
  if (await activeSession(userId, 'mines')) throw new Error('MINES_ACTIVE');
  const bet = betOf(amount); await debit(userId, bet, 'mines_bet', { game: 'mines' }, `mines:${userId}:${uid()}`);
  const s = await createSession(userId, 'mines', { bet, mines: minesLayout(3), opened: [], multiplier: 1 });
  return { ok: true, sessionId: s.id, active: true, opened: [], multiplier: 1, balance: (await userById(userId)).balance };
}
export async function minesStatus(userId) { const s = await activeSession(userId, 'mines'); const u = await userById(userId); return s ? { ok:true, active:true, opened:s.state.opened, multiplier:s.state.multiplier, balance:u.balance } : { ok:true, active:false, balance:u?.balance||0 }; }
export async function minesOpen(userId, index) {
  const s = await activeSession(userId, 'mines'); if (!s) throw new Error('NO_ACTIVE_MINES');
  const i = Math.floor(n(index, -1)); if (i < 0 || i >= 25) throw new Error('INVALID_TILE');
  if (s.state.opened.includes(i)) throw new Error('TILE_OPENED');
  if (s.state.mines.includes(i)) { await updateSession(s.id, { ...s.state, hitMine:i }, 'lost'); await recordGame(userId,'mines',s.state.bet,0,{mine:i},0); return { ok:true, active:false, mine:i, exploded:true, payout:0, balance:(await userById(userId)).balance }; }
  const opened = [...s.state.opened, i]; const multiplier = Number((1 + opened.length * 0.35).toFixed(2));
  await updateSession(s.id, { ...s.state, opened, multiplier });
  return { ok:true, active:true, opened, multiplier, balance:(await userById(userId)).balance };
}
export async function minesCashout(userId) {
  const s = await activeSession(userId, 'mines');
  if (!s) throw new Error('NO_ACTIVE_MINES');
  if (!s.state.opened.length) throw new Error('MINES_CASHOUT_LOCKED');
  const payout = Math.floor(s.state.bet * s.state.multiplier);
  if (!(await settleSession(s.id, 'settled'))) throw new Error('MINES_ALREADY_SETTLED');
  await credit(userId, payout, 'mines_win', { game: 'mines', multiplier: s.state.multiplier }, `mines-win:${s.id}`);
  const u = await recordGame(userId, 'mines', s.state.bet, payout, { opened: s.state.opened }, s.state.multiplier);
  return { ok: true, active: false, payout, multiplier: s.state.multiplier, balance: u.balance };
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
export async function blackjackAction(userId, roomId, action) { const s=await db.select().from(gameSessions).where(eq(gameSessions.id,`bj:${String(roomId||'solo')}`)).get(); if(!s) throw new Error('BJ_ROOM_NOT_FOUND'); const st=s.state; const me=st.players.find(p=>p.id===Number(userId)); if(!me) throw new Error('BJ_NOT_JOINED'); if(action==='hit'){me.cards.push(st.deck.pop()); if(cardValue(me.cards)>21) action='stand';} if(action==='stand'){me.stood=true;} if(!['hit','stand'].includes(action)) throw new Error('BJ_NOT_PLAYING'); if(st.players.every(p=>p.stood||cardValue(p.cards)>21)){while(cardValue(st.dealer)<17) st.dealer.push(st.deck.pop()); for(const p of st.players){const pv=cardValue(p.cards), dv=cardValue(st.dealer); let payout=0; if(pv<=21&&(dv>21||pv>dv)) payout=Math.floor(p.bet*2); else if(pv===dv) payout=p.bet; if(payout) await credit(p.id,payout,'blackjack_win',{game:'blackjack',roomId},`bj-win:${s.id}:${p.id}`); await recordGame(p.id,'blackjack',p.bet,payout,{player:pv,dealer:dv},payout/p.bet);} await updateSession(s.id,st,'settled');} else await updateSession(s.id,st); return blackjackStatus(userId,roomId); }

function shanCards() { const d=deck(); return [d.pop(),d.pop(),d.pop()]; }
export async function shanCreate(userId,title='Bika Shan Koe Mee Pro Table') { const id=`shan:${uid()}`; await db.insert(gameSessions).values({id,userId:Number(userId),game:'shan',status:'waiting',state:{title,players:[]},createdAt:now(),updatedAt:now()}).run(); return {ok:true,roomId:id.replace(/^shan:/,''),title}; }
export async function shanJoin(userId,roomId,amount){const id=`shan:${String(roomId||'').replace(/^shan:/,'')}`;const s=await db.select().from(gameSessions).where(eq(gameSessions.id,id)).get();if(!s)throw new Error('SHAN_ROOM_NOT_FOUND');const st=s.state||{};if(st.players.some(p=>p.id===Number(userId)))return shanStatus(userId,roomId);if(st.players.length>=6)throw new Error('SHAN_TABLE_FULL');const bet=betOf(amount);await debit(userId,bet,'shan_bet',{game:'shan',roomId},`shan:${id}:${userId}`);st.players.push({id:Number(userId),bet,cards:[]});await updateSession(id,st,'waiting');return shanStatus(userId,roomId);}
export async function shanStatus(userId,roomId){const id=`shan:${String(roomId||'').replace(/^shan:/,'')}`;const s=await db.select().from(gameSessions).where(eq(gameSessions.id,id)).get();if(!s)return {ok:true,active:false};const me=(s.state?.players||[]).find(p=>p.id===Number(userId));return {ok:true,active:s.status!=='settled',roomId:String(roomId||''),title:s.state.title,players:(s.state.players||[]).map(p=>({id:p.id,bet:p.bet,cards:p.cards,value:cardValue(p.cards)})),player:me||null};}
export async function shanDeal(userId,roomId,action='deal'){const id=`shan:${String(roomId||'').replace(/^shan:/,'')}`;const s=await db.select().from(gameSessions).where(eq(gameSessions.id,id)).get();if(!s)throw new Error('SHAN_ROOM_NOT_FOUND');const st=s.state||{};const me=st.players.find(p=>p.id===Number(userId));if(!me)throw new Error('SHAN_NOT_JOINED');if(action==='draw'&&me.cards.length<3)me.cards.push(...shanCards().slice(0,1));else if(action==='deal'&&!me.cards.length)me.cards=shanCards();else if(action==='stay')me.stayed=true;else if(action==='draw'&&me.cards.length>=3)throw new Error('SHAN_MAX_CARDS');if(st.players.every(p=>p.stayed||p.cards.length>=3)){const max=Math.max(...st.players.map(p=>cardValue(p.cards)));for(const p of st.players){const payout=cardValue(p.cards)===max?Math.floor(p.bet*2):0;if(payout)await credit(p.id,payout,'shan_win',{game:'shan',roomId},`shan-win:${id}:${p.id}`);await recordGame(p.id,'shan',p.bet,payout,{value:cardValue(p.cards)},payout/p.bet);}await updateSession(id,st,'settled');}else await updateSession(id,st);return shanStatus(userId,roomId);}

export async function config() { return { ok:true, coin:'$', games:['crash','slot','blackjack','shan','plinko','wheel','mines'], serverless:true, productionDataImported:false }; }
