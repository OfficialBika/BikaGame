'use strict';

const { env } = require('../../config/env');
const { getBotInfo } = require('../../config/bot');
const { replyHTML } = require('../../utils/telegram');
const { mentionHtml } = require('../../utils/helpers');
const { escHtml } = require('../../utils/format');
const { bets, parseSetEvent, parseBet, formatDate, fmt, getReplyRoot, findActiveEventByThread, createEvent, placeBet, stopEvent, settleEvent } = require('../../services/sportsEventService');
const { treasuryPayToUser } = require('../../services/economyService');

const isOwner = ctx => Number(ctx.from?.id) === Number(env.OWNER_ID);
const replyOpts = ctx => ctx.message?.message_id ? { reply_to_message_id: ctx.message.message_id, allow_sending_without_reply: true } : {};

function isBotTaggedPost(root) {
  const username = String(getBotInfo()?.username || process.env.BOT_USERNAME || '').replace(/^@/, '').toLowerCase();
  if (!username) return false;
  const text = String(root?.text || root?.caption || '');
  const escaped = username.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  return new RegExp('@' + escaped + '\\b', 'i').test(text);
}
function eventCard(e) {
  return [
    '🎯 <b>NEW EVENT START</b>','━━━━━━━━━━━━━━━━',
    '🏆 <b>' + escHtml(e.title) + '</b>','',
    '📊 <b>' + Number(e.teams[0].odd).toFixed(2) + '×</b>   |   <b>' + Number(e.teams[1].odd).toFixed(2) + '×</b>',
    '▫️ <b>' + escHtml(e.teams[0].name) + '</b> <code>' + escHtml(e.teams[0].alias) + '</code>   |   <b>' + escHtml(e.teams[1].name) + '</b> <code>' + escHtml(e.teams[1].alias) + '</code>','',
    '💰 <b>လောင်းကြေးထိုးနိုင်ပါပြီ</b>','',
    '📌 <b>လောင်းနည်း</b>',
    '<code>.bet ' + escHtml(e.teams[0].alias) + ' 20000</code>',
    '<code>.bet ' + escHtml(e.teams[1].alias) + ' 20000</code>','',
    '🟢 <b>BETTING OPEN</b>'
  ].join('\n');
}
function getUsage(){ return '❌ <b>Set Event Format မမှန်ပါ။</b>\n━━━━━━━━━━━━━━━━\n<code>/setevent Team A Vs Team B\n2× | 1.5×\nvan | pan</code>'; }
async function eventFromComment(ctx) {
  const root = getReplyRoot(ctx.message);
  return root?.message_id ? findActiveEventByThread(ctx.chat?.id, root.message_id) : null;
}
async function removeIncoming(ctx) { try { await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id); } catch (_) {} }
function betComplete(bet, ctx, no) {
  return [
    '✅ <b>BET COMPLETE</b>','━━━━━━━━━━━━━━━━',
    '🎟️ Bet - <b>' + no + '</b>',
    '👤 User - ' + mentionHtml(ctx.from),
    '💰 ထိုးကြေး - <b>' + fmt(bet.amount) + '</b> $',
    '🏆 အသင်း - <b>' + escHtml(bet.teamName) + '</b>',
    '📈 ပေါက်ကြေး - <b>' + Number(bet.odd).toFixed(2) + ' × ' + fmt(bet.amount) + ' = ' + fmt(bet.potentialWin) + '</b> $',
    '🕘 Date - <b>' + formatDate(bet.createdAt) + '</b>','',
    '🍀 ကံကောင်းပါစေရှင့်....'
  ].join('\n');
}
function winList(r) {
  const w=r.winners.slice().sort((a,b)=>b.potentialWin-a.potentialWin), lines=w.slice(0,10).map((b,i)=>(i+1)+'. '+(b.username?'@'+escHtml(b.username):escHtml(b.firstName||String(b.userId)))+'\n   <b>'+fmt(b.potentialWin)+' $</b>');
  if(w.length>10) lines.push('\n<b>And More +'+(w.length-10)+' ...........</b>');
  return ['🏆 <b>BET WIN LIST</b>','━━━━━━━━━━━━━━━━',lines.join('\n\n')||'<i>No winning bets</i>','',
    '📊 <b>Total BET</b> = '+r.allBets.length,
    '🟢 <b>Total Win</b> = '+r.winners.length,
    '🔴 <b>Total Lose</b> = '+r.losers.length,
    '💰 <b>Total Bet Bal</b> = '+fmt(r.allBets.reduce((s,b)=>s+b.amount,0))+' $',
    '🏆 <b>Total Win Bal</b> = '+fmt(r.winners.reduce((s,b)=>s+b.potentialWin,0))+' $','',
    '🙏 <b>ပါဝင်သူအားလုံးကို ကျေးဇူးတင်ပါတယ်ရှင့်။</b>'].join('\n');
}

module.exports = (bot) => {
  bot.hears(/^\/setevent(?:@[\w_]+)?\s+/i, async ctx => {
    if (!isOwner(ctx)) return;
    const root=getReplyRoot(ctx.message);
    if(!root || !isBotTaggedPost(root)) return replyHTML(ctx,'⚠️ <b>Game Bot username ပါတဲ့ Channel Post ရဲ့ comment ကို reply လုပ်ပြီး /setevent ပို့ပါ။</b>',replyOpts(ctx));
    const parsed=parseSetEvent(ctx.message.text);
    if(!parsed) return replyHTML(ctx,getUsage(),replyOpts(ctx));
    if(await findActiveEventByThread(ctx.chat.id,root.message_id)) return replyHTML(ctx,'⚠️ <b>ဒီ Post မှာ Event တစ်ခု ရှိပြီးသားပါ။</b>',replyOpts(ctx));
    const event=await createEvent({postChatId:String(root.chat?.id||ctx.chat.id),postMessageId:Number(root.message_id),commentChatId:String(ctx.chat.id),threadRootMessageId:Number(root.message_id),sourcePostText:String(root.text||root.caption||'').slice(0,4000),title:parsed.title,teams:parsed.teams});
    return replyHTML(ctx,eventCard(event),replyOpts(ctx));
  });

  bot.hears(/^\.stopbet\s*$/i, async ctx => {
    if(!isOwner(ctx)) return;
    const event=await eventFromComment(ctx); if(!event) return;
    if(event.status!=='open') return replyHTML(ctx,'ℹ️ <b>Betting ပိတ်ထားပြီးသားပါ။</b>',replyOpts(ctx));
    await stopEvent(event);
    return replyHTML(ctx,'🔒 <b>BETTING CLOSED</b>\n━━━━━━━━━━━━━━━━\n🏆 '+escHtml(event.title)+'\n\nလောင်းကြေးအသစ်များကို လက်မခံတော့ပါ။\n\n⏳ <b>Owner က .betwin van (or) pan နဲ့ အနိုင်အသင်း သတ်မှတ်နိုင်ပါပြီ။</b>',replyOpts(ctx));
  });

  bot.hears(/^\.betwin\s+([a-z0-9_-]+)\s*$/i, async ctx => {
    if(!isOwner(ctx)) return;
    const event=await eventFromComment(ctx); if(!event) return;
    if(event.status!=='stopped') return replyHTML(ctx,'⚠️ <b>အရင် .stopbet လုပ်ပေးပါ။</b>',replyOpts(ctx));
    const alias=String(ctx.match[1]).toLowerCase();
    if(!event.teams.some(t=>t.alias===alias)) return replyHTML(ctx,'❌ <b>Winner alias မမှန်ပါ။</b>',replyOpts(ctx));
    try { const result=await settleEvent(event,alias,treasuryPayToUser); return replyHTML(ctx,winList(result),replyOpts(ctx)); }
    catch(err) { return replyHTML(ctx,'⚠️ <b>Settlement Failed</b>\n<code>'+escHtml(err?.message||err)+'</code>',replyOpts(ctx)); }
  });

  bot.on('message', async (ctx,next) => {
    const event=await eventFromComment(ctx); if(!event) return next();
    if(isOwner(ctx)) return next();
    const text=String(ctx.message?.text||'').trim();
    const parsed=parseBet(text);
    if(!parsed){ await removeIncoming(ctx); return; }
    if(event.status!=='open'){ await removeIncoming(ctx); return replyHTML(ctx,'🔒 <b>BETTING ပိတ်ပြီးပါပြီ။</b>\nဒီထိုးကြေးကို လက်မခံတော့ပါ။',replyOpts(ctx)); }
    try {
      const existing=await bets().findOne({eventId:event._id,userId:Number(ctx.from.id)});
      if(existing){ await removeIncoming(ctx); return replyHTML(ctx,'⚠️ <b>သင် ထိုးကြေးတင်ပြီးပါပြီ။</b>\nပွဲပြီးအောင် စောင့်ပေးပါ။',replyOpts(ctx)); }
      const bet=await placeBet(event,ctx,parsed.alias,parsed.amount);
      const no=Number(event.totalBet||0)+1;
      return replyHTML(ctx,betComplete(bet,ctx,no),replyOpts(ctx));
    } catch(err) {
      const m=String(err?.message||err);
      if(m==='DUPLICATE_BET') return replyHTML(ctx,'⚠️ <b>သင် ထိုးကြေးတင်ပြီးပါပြီ။</b>\nပွဲပြီးအောင် စောင့်ပေးပါ။',replyOpts(ctx));
      if(m==='USER_INSUFFICIENT') return replyHTML(ctx,'❌ <b>Balance မလုံလောက်ပါ။</b>\nလက်ကျန်ငွေကို စစ်ပြီး ထပ်မံကြိုးစားပါ။',replyOpts(ctx));
      if(m==='INVALID_TEAM') return replyHTML(ctx,'❌ <b>အသင်း alias မမှန်ပါ။</b>\n'+event.teams.map(t=>'<code>'+escHtml(t.alias)+'</code> = '+escHtml(t.name)).join('\n'),replyOpts(ctx));
      if(m==='INVALID_AMOUNT') return replyHTML(ctx,'❌ <b>ထိုးကြေးပမာဏ မမှန်ပါ။</b>',replyOpts(ctx));
      return replyHTML(ctx,'⚠️ <b>Bet failed</b>\n<code>'+escHtml(m)+'</code>',replyOpts(ctx));
    }
  });
};
