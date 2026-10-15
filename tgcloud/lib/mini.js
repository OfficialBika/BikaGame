import { EndpointError } from 'sdk';
import { ensurePreviewUser, userById, history, playSlot, playPlinko, wheelSpin, dailyWheel, crashStart, crashStatus, crashCashout, minesStart, minesStatus, minesOpen, minesCashout, blackjackJoin, blackjackStatus, blackjackAction, shanCreate, shanJoin, shanStatus, shanDeal, debit, credit } from './game.js';
import { listTopUsers } from './users.js';
import { miniConfig } from './config.js';

function user(ctx) {
  const u = ctx?.initData?.user;
  if (!u?.id) throw new EndpointError('A verified Telegram Mini App user is required.', { code: 'AUTH_REQUIRED' });
  return u;
}
function walletView(u) {
  const walletId=String(u.tgId);
  return { walletId, maskedWalletId:walletId.length>4?`${walletId.slice(0,2)}••••${walletId.slice(-2)}`:walletId, balance:Number(u.balance||0), username:u.username||null, firstName:u.firstName, lastName:u.lastName, photoUrl:u.photoUrl||null };
}
export async function dispatch(action, input, ctx) {
  const tg=user(ctx); const id=Number(tg.id); await ensurePreviewUser(tg); const body=input&&typeof input==='object'?input:{};
  switch(action){
    case 'config': return miniConfig();
    case 'me': { const u=await userById(id); return {ok:true,user:{id:u.tgId,username:u.username,firstName:u.firstName,lastName:u.lastName,languageCode:u.languageCode,balance:u.balance},profile:{id:u.tgId,username:u.username,firstName:u.firstName,lastName:u.lastName,languageCode:u.languageCode},wallet:{...walletView(u),currency:'$',environment:'serverless-preview'},productionDataImported:false}; }
    case 'wallet': { const u=await userById(id); return {ok:true,wallet:walletView(u)}; }
    case 'walletLookup': { const targetId=Number(String(body.walletId||'')); if(!Number.isSafeInteger(targetId)||targetId<=0)throw new EndpointError('Wallet ID မမှန်ပါ။',{code:'WALLET_INVALID'}); const u=await userById(targetId); if(!u)throw new EndpointError('ဒီ Wallet ID ပိုင်ရှင်ကို မတွေ့ပါ။',{code:'WALLET_NOT_FOUND'}); return {ok:true,wallet:walletView(u)}; }
    case 'walletTransfer': { const targetId=Number(String(body.walletId||'')); const amount=Math.floor(Number(body.amount)); if(!Number.isSafeInteger(targetId)||targetId<=0)throw new EndpointError('Wallet ID မမှန်ပါ။',{code:'WALLET_INVALID'}); if(!Number.isFinite(amount)||amount<=0)throw new EndpointError('Transfer amount မမှန်ပါ။',{code:'INVALID_TRANSFER_AMOUNT'}); if(targetId===id)throw new EndpointError('ကိုယ့် Wallet ကိုယ် ပြန်လွှဲလို့မရပါ။',{code:'TRANSFER_SELF'}); const target=await userById(targetId); if(!target)throw new EndpointError('ဒီ Wallet ID ပိုင်ရှင်ကို မတွေ့ပါ။',{code:'WALLET_NOT_FOUND'}); const key=`preview-transfer:${id}:${targetId}:${Date.now()}`; await debit(id,amount,'gift',{source:'mini_wallet',toUserId:targetId},key+':debit'); await credit(targetId,amount,'gift',{source:'mini_wallet',fromUserId:id},key+':credit'); const sender=await userById(id); return {ok:true,amount,senderBalance:sender.balance,recipientUserId:targetId,recipientWalletId:String(targetId)}; }
    case 'history': return {ok:true,items:await history(id,body.game||'all',body.limit||20)};
    case 'leaderboard': return {ok:true,items:await listTopUsers(body.limit||10)};
    case 'slotSpin': return playSlot(id,body.bet);
    case 'plinkoDrop': return playPlinko(id,body.bet);
    case 'wheelSpin': return wheelSpin(id,body.bet);
    case 'wheelDailyStatus': {const u=await userById(id);const today=new Date().toISOString().slice(0,10);const last=u.dailyClaimedAt?new Date(u.dailyClaimedAt).toISOString().slice(0,10):'';return {ok:true,available:today!==last,claimed:today===last,date:today,baseReward:100};}
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
    case 'backgroundMusic': return {ok:true,enabled:false};
    default: throw new EndpointError('This Serverless feature is not available.',{code:'NOT_PORTED',action});
  }
}
