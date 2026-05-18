const { ensureTreasury, isOwner } = require('../services/treasuryService');
const { isCommandLikeText } = require('../utils/helpers');
const { replyHTML } = require('../utils/telegram');
function bypass(text=''){ return /^\/(on|off|broadcastend|setvipwr|vipwr|ping|status)(@\w+)?\b/i.test(String(text).trim()); }
module.exports = async (ctx,next)=>{ const t=await ensureTreasury(); if(isOwner(ctx,t)) return next(); const text=String(ctx.message?.text||ctx.callbackQuery?.data||'').trim(); if(!(ctx.updateType==='callback_query'||isCommandLikeText(text))) return next(); if(bypass(text)) return next(); if(t?.maintenanceMode){ if(ctx.updateType==='callback_query'){ try{ await ctx.answerCbQuery('Bot ပြုပြင်နေပါတယ်။',{show_alert:true}); }catch(_){} return; } return replyHTML(ctx,'🛠️ <b>Bot ပြုပြင်နေပါတယ်</b>\n━━━━━━━━━━━━\nခေတ္တစောင့်ဆိုင်းပေးပါ။'); } return next(); };
