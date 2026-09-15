'use strict';

const { COIN } = require('../../config/constants');
const { ensureTreasury, getTreasury, isOwner, setTotalSupply, setVipWinRate, setRtpWinRate } = require('../../services/treasuryService');
const { getUser, ensureUser, treasuryPayToUser, userPayToTreasury } = require('../../services/economyService');
const { parseAmount, mentionHtml, userDocLabelHtml } = require('../../utils/helpers');
const { replyHTML } = require('../../utils/telegram');
const { fmt, escHtml } = require('../../utils/format');
const { cleanGameKey, gameLabel, getWebGameRtp, getAllWebGameRtps, setWebGameRtp, GAME_LABELS } = require('../../services/webGameRtpService');

function replyOptions(ctx) { const messageId = ctx.message?.message_id; return messageId ? { reply_to_message_id: messageId } : {}; }
function parsePercent(text) { const raw = String(text || '').trim().split(/\s+/)[1]; const n = Number(raw); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.floor(n))) : null; }
function parseNumberToken(value) { const n = Number(String(value || '').replace(/,/g, '')); return Number.isFinite(n) ? Math.floor(n) : null; }
function parseBalanceCommand(ctx) { const parts=String(ctx.message?.text||'').trim().split(/\s+/).filter(Boolean); const replyUser=ctx.message?.reply_to_message?.from||null; if(replyUser)return{targetUser:replyUser,targetUserId:replyUser.id,amount:parseNumberToken(parts[1]),mode:'reply'}; return{targetUser:null,targetUserId:parseNumberToken(parts[1]),amount:parseNumberToken(parts[2]),mode:'userid'}; }
function balanceUsage(command) { return `Usage:\nReply နဲ့: <code>/${command} 10000</code>\nUser ID နဲ့: <code>/${command} 123456789 10000</code>`; }
async function requireOwner(ctx) { const t=await ensureTreasury(); if(!isOwner(ctx,t)){await replyHTML(ctx,'⛔ Owner only.',replyOptions(ctx));return null;} return t; }

async function runAdminBalanceAdjust(ctx,type){
  const t=await requireOwner(ctx); if(!t)return;
  const command=type==='add'?'addbal':'rmbal'; const parsed=parseBalanceCommand(ctx);
  if(!parsed.targetUserId||parsed.targetUserId<=0||!parsed.amount||parsed.amount<=0)return replyHTML(ctx,balanceUsage(command),replyOptions(ctx));
  if(parsed.targetUser)await ensureUser(parsed.targetUser);
  const beforeUser=await getUser(parsed.targetUserId); const beforeBalance=Number(beforeUser?.balance||0);
  try{if(type==='add')await treasuryPayToUser(parsed.targetUserId,parsed.amount,{type:'owner_addbal',byUserId:ctx.from.id,mode:parsed.mode});else await userPayToTreasury(parsed.targetUserId,parsed.amount,{type:'owner_rmbal',byUserId:ctx.from.id,mode:parsed.mode});}
  catch(err){const message=String(err?.message||err);if(message.includes('TREASURY_INSUFFICIENT'))return replyHTML(ctx,`❌ <b>Bot Bank balance မလုံလောက်ပါ။</b>\n━━━━━━━━━━━━━━\nNeed: <b>${fmt(parsed.amount)}</b> ${COIN}\nCheck: <code>/treasury</code>`,replyOptions(ctx));if(message.includes('USER_INSUFFICIENT'))return replyHTML(ctx,`❌ <b>User balance မလုံလောက်ပါ။</b>\n━━━━━━━━━━━━━━\nUser ID: <code>${parsed.targetUserId}</code>\nCurrent: <b>${fmt(beforeBalance)}</b> ${COIN}\nRemove: <b>${fmt(parsed.amount)}</b> ${COIN}`,replyOptions(ctx));return replyHTML(ctx,`⚠️ <b>Balance update error</b>\n<code>${escHtml(message)}</code>`,replyOptions(ctx));}
  const afterUser=await getUser(parsed.targetUserId),tr=await getTreasury(); const targetLabel=parsed.targetUser?mentionHtml(parsed.targetUser):userDocLabelHtml(afterUser||{userId:parsed.targetUserId}); const title=type==='add'?'✅ Balance Added':'✅ Balance Removed'; const sign=type==='add'?'+':'-';
  return replyHTML(ctx,`${title}\n━━━━━━━━━━━━━━\nTarget: ${targetLabel}\nUser ID: <code>${parsed.targetUserId}</code>\nAmount: <b>${sign}${fmt(parsed.amount)}</b> ${COIN}\nBefore: <b>${fmt(beforeBalance)}</b> ${COIN}\nAfter: <b>${fmt(afterUser?.balance||0)}</b> ${COIN}\nBot Bank: <b>${fmt(tr?.ownerBalance||0)}</b> ${COIN}`,replyOptions(ctx));
}

function webRtpUsage(){return `🎮 <b>Web Game RTP Control</b>\n━━━━━━━━━━━━━━\n<code>/setwebrtp rocket 76</code>\n<code>/setwebrtp slot 65</code>\n<code>/setwebrtp plinko 72</code>\n<code>/setwebrtp wheel 70</code>\n<code>/setwebrtp mines 68</code>\n<code>/setwebrtp blackjack 68</code>\n<code>/setwebrtp shan 68</code>\n\nView all: <code>/webrtp</code>\nView one: <code>/webrtp rocket</code>\n\nRTP = global game target; player တစ်ဦးချင်းစီကို မခွဲထိန်းပါ။`}
async function setWebRtpCommand(ctx){
  const t=await requireOwner(ctx); if(!t)return;
  const parts=String(ctx.message?.text||'').trim().split(/\s+/).filter(Boolean);
  const game=cleanGameKey(parts[1]); const value=parts[2];
  if(!GAME_LABELS[game]||value==null)return replyHTML(ctx,webRtpUsage(),replyOptions(ctx));
  const n=await setWebGameRtp(game,value,ctx.from.id);
  return replyHTML(ctx,`✅ <b>${escHtml(gameLabel(game))} RTP Updated</b>\n━━━━━━━━━━━━━━\nTarget RTP: <b>${n}%</b>\nGame: <b>${escHtml(game)}</b>`,replyOptions(ctx));
}
async function showWebRtp(ctx){
  const t=await requireOwner(ctx); if(!t)return;
  const parts=String(ctx.message?.text||'').trim().split(/\s+/).filter(Boolean); const game=cleanGameKey(parts[1]);
  if(parts[1]&&GAME_LABELS[game]){const n=await getWebGameRtp(game);return replyHTML(ctx,`🎮 <b>${escHtml(gameLabel(game))} RTP</b>\n━━━━━━━━━━━━━━\nTarget: <b>${n}%</b>\nChange: <code>/setwebrtp ${game} ${n}</code>`,replyOptions(ctx));}
  const all=await getAllWebGameRtps(); const lines=Object.keys(GAME_LABELS).map(k=>`• <b>${escHtml(gameLabel(k))}</b>: <b>${all[k]}%</b>`).join('\n');
  return replyHTML(ctx,`🎮 <b>Web Game RTP Dashboard</b>\n━━━━━━━━━━━━━━\n${lines}\n━━━━━━━━━━━━━━\n<code>/setwebrtp rocket 76</code>`,replyOptions(ctx));
}

module.exports=(bot)=>{
  bot.command('settotal',async(ctx)=>{const t=await requireOwner(ctx);if(!t)return;const amount=parseAmount(ctx.message.text);if(!amount||amount<=0)return replyHTML(ctx,'Usage: <code>/settotal 5000000</code>',replyOptions(ctx));await setTotalSupply(amount);const tr=await getTreasury();return replyHTML(ctx,`🏦 <b>Treasury Initialized</b>\n━━━━━━━━━━━━━━\n• Total Supply: <b>${fmt(tr.totalSupply)}</b> ${COIN}\n• Owner Balance: <b>${fmt(tr.ownerBalance)}</b> ${COIN}`,replyOptions(ctx));});
  bot.command('treasury',async(ctx)=>{const t=await requireOwner(ctx);if(!t)return;const tr=await getTreasury();const rtps=await getAllWebGameRtps();const webLines=Object.keys(GAME_LABELS).map(k=>`${gameLabel(k)}: <b>${rtps[k]}%</b>`).join(' • ');return replyHTML(ctx,`🏦 <b>Treasury Dashboard</b>\n━━━━━━━━━━━━━━\n• Total Supply: <b>${fmt(tr.totalSupply)}</b> ${COIN}\n• Bot Bank: <b>${fmt(tr.ownerBalance)}</b> ${COIN}\n• Owner ID: <code>${tr.ownerUserId}</code>\n• VIP WR: <b>${tr.vipWinRate}%</b>\n• Legacy Slot WR: <b>${tr.rtpWinRate??35}%</b>\n• Web RTP: ${webLines}\n━━━━━━━━━━━━━━\n<code>/setwebrtp rocket 76</code>`,replyOptions(ctx));});
  bot.command('addbal',async(ctx)=>runAdminBalanceAdjust(ctx,'add'));
  bot.command('rmbal',async(ctx)=>runAdminBalanceAdjust(ctx,'remove'));
  bot.command('setvipwr',async(ctx)=>{const t=await requireOwner(ctx);if(!t)return;const rate=parsePercent(ctx.message.text);if(rate==null)return replyHTML(ctx,'Usage: <code>/setvipwr 90</code>',replyOptions(ctx));const n=await setVipWinRate(rate);return replyHTML(ctx,`✅ VIP Win Rate Updated: <b>${n}%</b>`,replyOptions(ctx));});
  bot.command('vipwr',async(ctx)=>{const t=await requireOwner(ctx);if(!t)return;return replyHTML(ctx,`📊 VIP Win Rate: <b>${t.vipWinRate}%</b>`,replyOptions(ctx));});

  // Backward-compatible /setrtp 35 remains the legacy Slot WinRate control.
  // New Web/Mini App games use /setwebrtp <game> <percent>.
  bot.command('setrtp',async(ctx)=>{const parts=String(ctx.message?.text||'').trim().split(/\s+/).filter(Boolean);if(parts.length>=3)return setWebRtpCommand(ctx);const t=await requireOwner(ctx);if(!t)return;const rate=parsePercent(ctx.message.text);if(rate==null)return replyHTML(ctx,`Usage: <code>/setrtp 35</code> (legacy slot)\n${webRtpUsage()}`,replyOptions(ctx));const n=await setRtpWinRate(rate);return replyHTML(ctx,`🎰 <b>Legacy Slot RTP WinRate Updated</b>\n━━━━━━━━━━━━━━\nNew: <b>${n}%</b>`,replyOptions(ctx));});
  bot.command('rtp',async(ctx)=>{const parts=String(ctx.message?.text||'').trim().split(/\s+/).filter(Boolean);if(parts[1])return showWebRtp(ctx);const t=await requireOwner(ctx);if(!t)return;return replyHTML(ctx,`🎰 <b>Legacy Slot RTP WinRate</b>\n━━━━━━━━━━━━━━\nCurrent: <b>${t.rtpWinRate??35}%</b>\nChange: <code>/setrtp 35</code>\nWeb games: <code>/webrtp</code>`,replyOptions(ctx));});
  bot.command('setwebrtp',setWebRtpCommand);
  bot.command('webrtp',showWebRtp);
};
