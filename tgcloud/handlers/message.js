import { api } from 'sdk';
import { ensureUser, formatCoin, displayName, listTopUsers } from '../lib/users.js';
import { playSlot, playPlinko, wheelSpin, dailyWheel, crashStart, minesStart, blackjackJoin, shanCreate, shanJoin } from '../lib/game.js';

function parseCommand(text) {
  const m = String(text || '').trim().match(/^\/([a-z0-9_]+)(?:@[a-z0-9_]+)?(?:\s+([\s\S]*))?$/i);
  return m ? { name:m[1].toLowerCase(), args:(m[2]||'').trim() } : null;
}
function args(text) { return String(text||'').trim().split(/\s+/).filter(Boolean); }
async function send(chatId,text,replyToMessageId,replyMarkup) {
  const p={chat_id:chatId,text};
  if(replyToMessageId) p.reply_parameters={message_id:Number(replyToMessageId),allow_sending_without_reply:true};
  if(replyMarkup) p.reply_markup=replyMarkup;
  return api.sendMessage(p);
}
const kb=(rows)=>({inline_keyboard:rows});
function helpText(){return ['🎮 BIKA Game — Serverless preview','', '/start — initialize preview profile','/help — commands','/balance — preview balance','/daily — daily reward','/top10 — preview leaderboard','/slot <bet> — slot','/plinko <bet> — plinko','/wheel <bet> — lucky wheel','/mines <bet> — mines','/crash <bet> — rocket crash','/blackjack <bet> [room] — blackjack table','/shan <bet> [room] — Shan Koe Mee','/wallet — wallet id and balance','/serverlessstatus — migration status','', '⚠️ This is an isolated Serverless preview. Production MongoDB is never read or modified.'];}

export default async function(message){
  const chatId=message?.chat?.id, from=message?.from;
  if(!chatId||!from||from.is_bot)return;
  const c=parseCommand(message.text); if(!c)return;
  try{
    if(c.name==='help'){return send(chatId,helpText(),message.message_id);}
    if(c.name==='serverlessstatus'){return send(chatId,['BIKA Serverless preview status','• Bot handler: available','• Profile / wallet read: available','• Games: preview runtime enabled','• Mini App endpoints: available','• Production MongoDB import: NOT RUN','• Production cutover: NOT APPROVED'].join('\n'),message.message_id);}
    const user=await ensureUser(from);
    if(c.name==='start') return send(chatId,`👋 Welcome to BIKA Game Serverless preview, ${displayName(user)}!\n\nYour isolated preview profile is ready.\nBalance: ${formatCoin(user.balance)} $\n\n⚠️ No production balance, bonus or wager was imported.`,message.message_id);
    if(c.name==='balance'||c.name==='mybalance') return send(chatId,`💼 BIKA Preview Wallet\nPlayer: ${displayName(user)}\nBalance: ${formatCoin(user.balance)} $\nWallet ID: ${user.tgId}\n\nPreview database only.`,message.message_id);
    if(c.name==='wallet') return send(chatId,`💳 BIKA Preview Wallet\nID: ${user.tgId}\nBalance: ${formatCoin(user.balance)} $\n\nUse /transfer <wallet_id> <amount> for preview transfers.`,message.message_id);
    if(c.name==='top10'){const r=await listTopUsers(10);return send(chatId,'🏆 BIKA Preview Top 10\n\n'+(r.length?r.map((x,i)=>`${i+1}. ${displayName(x)} — ${formatCoin(x.balance)} $`).join('\n'):'No players yet.'),message.message_id);}
    if(c.name==='daily'){const r=await dailyWheel(user.tgId);return send(chatId,`🎁 Daily reward: +${formatCoin(r.reward)} $\nBalance: ${formatCoin(r.balance)} $`,message.message_id);}
    const a=args(c.args), bet=a[0];
    if(c.name==='slot'){const r=await playSlot(user.tgId,bet);return send(chatId,`🎰 SLOT\n\n${r.reels.join(' | ')}\nMultiplier: x${r.multiplier}\nPayout: ${formatCoin(r.payout)} $\nBalance: ${formatCoin(r.balance)} $`,message.message_id);}
    if(c.name==='plinko'){const r=await playPlinko(user.tgId,bet);return send(chatId,`🟡 PLINKO\nMultiplier: x${r.multiplier}\nPayout: ${formatCoin(r.payout)} $\nBalance: ${formatCoin(r.balance)} $`,message.message_id);}
    if(c.name==='wheel'){const r=await wheelSpin(user.tgId,bet);return send(chatId,`🎡 LUCKY WHEEL\nReward: ${r.reward}%\nPayout: ${formatCoin(r.payout)} $\nBalance: ${formatCoin(r.balance)} $`,message.message_id);}
    if(c.name==='crash'){const r=await crashStart(user.tgId,bet);return send(chatId,`🚀 ROCKET CRASH\nRound started.\nCurrent: x1.00\n\nPress Cash Out before the rocket crashes.`,message.message_id,kb([[{text:'💰 CASH OUT',callback_data:`crash:cashout:${r.sessionId}`}]]));}
    if(c.name==='mines'){const r=await minesStart(user.tgId,bet);return send(chatId,`💣 MINES\nRound started. Multiplier x1.00\nChoose a tile.`,message.message_id,kb([[0,1,2,3,4].map(i=>({text:String(i+1),callback_data:`mines:open:${i}`}))],[5,6,7,8,9].map(i=>({text:String(i+1),callback_data:`mines:open:${i}`})),[{text:'💰 CASH OUT',callback_data:'mines:cashout'}]]));}
    if(c.name==='blackjack'){const room=a[1]||'solo';const r=await blackjackJoin(user.tgId,room,bet);return send(chatId,`🂡 BLACKJACK\nRoom: ${room}\nYour cards: ${(r.player?.cards||[]).map(x=>x.r+x.s).join(' ')}\nValue: ${r.player?.cards?.length?'-':'—'}`,message.message_id,kb([[{text:'HIT',callback_data:`bj:hit:${room}`},{text:'STAND',callback_data:`bj:stand:${room}`}]]));}
    if(c.name==='shan'){const room=a[1];if(room){const r=await shanJoin(user.tgId,room,bet);return send(chatId,`🎴 SHAN KOE MEE\nRoom: ${room}\nPlayers: ${r.players?.length||0}`,message.message_id);}const r=await shanCreate(user.tgId);return send(chatId,`🎴 Shan table created\nRoom ID: ${r.roomId}\nJoin with /shan <bet> ${r.roomId}`,message.message_id);}
    if(c.name==='transfer'){const target=Number(a[0]), amount=Math.floor(Number(a[1]));if(!target||!amount||amount<1)throw new Error('INVALID_TRANSFER');const sender=await ensureUser(from);if(sender.balance<amount)throw new Error('USER_INSUFFICIENT');const recipient=await ensureUser({id:target,first_name:'Preview Player'});await (await import('../lib/game.js')).debit(sender.tgId,amount,'gift',{toUserId:target},`gift:${sender.tgId}:${target}:${Date.now()}`);await (await import('../lib/game.js')).credit(recipient.tgId,amount,'gift',{fromUserId:sender.tgId},`gift:${sender.tgId}:${target}:${Date.now()}`);return send(chatId,`💸 Transfer complete\nSent: ${formatCoin(amount)} $\nTo: ${target}\nBalance: ${formatCoin((await ensureUser(from)).balance)} $`,message.message_id);}
    return send(chatId,'This command is not ported to Serverless preview yet. No production data was changed.',message.message_id);
  }catch(error){console.error('BIKA_SERVERLESS_MESSAGE_HANDLER_FAILED',error);const msg=String(error?.message||error);const safe={USER_INSUFFICIENT:'Balance မလုံလောက်ပါ။',WHEEL_DAILY_USED:'Daily reward ကို ဒီနေ့ claim လုပ်ပြီးသားပါ။',CRASH_RUNNING:'Crash round လက်ရှိ run နေပါတယ်။',MINES_ACTIVE:'Mines round လက်ရှိ run နေပါတယ်။',NO_ACTIVE_CRASH:'Active Crash round မရှိပါ။',NO_ACTIVE_MINES:'Active Mines round မရှိပါ။',MINES_CASHOUT_LOCKED:'Safe tile အနည်းဆုံး ၁ ခု ဖွင့်ပြီးမှ cash out လုပ်ပါ။',BJ_TABLE_FULL:'Blackjack table ပြည့်နေပါပြီ။',SHAN_TABLE_FULL:'Shan table ပြည့်နေပါပြီ။'};await send(chatId,`⚠️ ${safe[msg]||'Preview command failed safely. No production data was changed.'}`,message.message_id);}
}
