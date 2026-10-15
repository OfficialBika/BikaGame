import { EndpointError } from 'sdk';
import { ensurePreviewUser, userById, history, playSlot, playPlinko, wheelSpin, dailyWheel, crashStart, crashStatus, crashCashout, minesStart, minesStatus, minesOpen, minesCashout, blackjackJoin, blackjackStatus, blackjackAction, shanCreate, shanJoin, shanStatus, shanDeal, config } from './game.js';
import { listTopUsers } from './users.js';

function user(ctx) {
  const u = ctx?.initData?.user;
  if (!u?.id) throw new EndpointError('A verified Telegram Mini App user is required.', { code: 'AUTH_REQUIRED' });
  return u;
}

export async function dispatch(action, input, ctx) {
  const tg = user(ctx);
  const id = Number(tg.id);
  await ensurePreviewUser(tg);
  const body = input && typeof input === 'object' ? input : {};
  switch (action) {
    case 'config': return config();
    case 'me': {
      const u = await userById(id);
      return { ok:true, profile:{id:u.tgId,username:u.username,firstName:u.firstName,lastName:u.lastName,languageCode:u.languageCode}, wallet:{balance:u.balance,currency:'$',environment:'serverless-preview'}, productionDataImported:false };
    }
    case 'history': return { ok:true, items:await history(id,body.game||'all',body.limit||20) };
    case 'leaderboard': return { ok:true, items:await listTopUsers(body.limit||10) };
    case 'slotSpin': return playSlot(id,body.bet);
    case 'plinkoDrop': return playPlinko(id,body.bet);
    case 'wheelSpin': return wheelSpin(id,body.bet);
    case 'wheelDailyStatus': { const u=await userById(id); const today=new Date().toISOString().slice(0,10); const last=u.dailyClaimedAt?new Date(u.dailyClaimedAt).toISOString().slice(0,10):''; return {ok:true,claimed:today===last,date:today,baseReward:100}; }
    case 'wheelDailySpin': return dailyWheel(id);
    case 'crashStart': case 'crashBet': return crashStart(id,body.bet);
    case 'crashStatus': return crashStatus(id);
    case 'crashCashout': return crashCashout(id);
    case 'minesStart': return minesStart(id,body.bet);
    case 'minesStatus': return minesStatus(id);
    case 'minesOpen': return minesOpen(id,body.index);
    case 'minesCashout': return minesCashout(id);
    case 'blackjackStatus': return blackjackStatus(id,body.roomId);
    case 'blackjackJoin': return blackjackJoin(id,body.roomId,body.bet);
    case 'blackjackHit': return blackjackAction(id,body.roomId,'hit');
    case 'blackjackStand': return blackjackAction(id,body.roomId,'stand');
    case 'shanCreate': return shanCreate(id,body.title);
    case 'shanStatus': return shanStatus(id,body.roomId);
    case 'shanJoin': return shanJoin(id,body.roomId,body.bet);
    case 'shanDraw': return shanDeal(id,body.roomId,'draw');
    case 'shanStay': return shanDeal(id,body.roomId,'stay');
    case 'shanDeal': return shanDeal(id,body.roomId,'deal');
    default: throw new EndpointError('This Serverless feature is not available.', { code:'NOT_PORTED', action });
  }
}
