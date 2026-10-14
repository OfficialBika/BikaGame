'use strict';
const { COIN } = require('../../config/constants');
const { env } = require('../../config/env');
const { getUser } = require('../../services/economyService');
const { creditBalanceFromStars } = require('../../services/starsBalanceService');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { mentionHtml } = require('../../utils/helpers');
const { getBalanceRank } = require('../../utils/ranking');
const { getBotInfo } = require('../../config/bot');
const { walletIdForUserId, getWallet } = require('../../services/walletService');

const STAR_PACKAGES = [10, 20, 30, 40, 50, 100];
const STAR_PAYLOAD_PREFIX = 'bika_bal_v1';

function replyOptions(ctx){const messageId=ctx.message?.message_id;return messageId?{reply_to_message_id:messageId,allow_sending_without_reply:true}:{};}
function payKeyboard(ctx){const username=String(getBotInfo()?.username||process.env.BOT_USERNAME||'').replace(/^@/,'');if(!username||!ctx.from?.id)return undefined;return {inline_keyboard:[[{text:'💸 Pay Bal',style:'primary',url:`https://t.me/${username}?startapp=${encodeURIComponent(`pay_${walletIdForUserId(ctx.from.id)}`)}`}],[{text:'⭐ Bal ဝယ်ယူရန်',callback_data:'stars:menu'}]]};}
function balanceText(ctx,u){const balance=Number(u?.balance||0),totalWon=Number(u?.totalWon||0),totalLost=Number(u?.totalLost||0),r=getBalanceRank(u?.balance);return `${r.badge} <b>BIKA Wallet</b>\n━━━━━━━━━━━━━━\n👤 ${mentionHtml(ctx.from)}\n💰 Balance: <b>${fmt(balance)}</b> ${COIN}\n🏆 Total Won: <b>${fmt(totalWon)}</b> ${COIN}\n💸 Total Lost: <b>${fmt(totalLost)}</b> ${COIN}\n🏷️ Rank: <b>${r.title}</b>\n━━━━━━━━━━━━━━`;}
async function sendBalance(ctx){const u=await getUser(ctx.from.id);return replyHTML(ctx,balanceText(ctx,u),{...replyOptions(ctx),reply_markup:payKeyboard(ctx)});}
function packageKeyboard(){return {inline_keyboard:[[10,20,30].map(stars=>({text:`⭐ ${stars} Stars`,callback_data:`stars:buy:${stars}`})),[40,50,100].map(stars=>({text:`⭐ ${stars} Stars`,callback_data:`stars:buy:${stars}`}))],[{text:'❌ Close',callback_data:'stars:close'}]]};}
function packageText(){return `⭐ <b>BIKA Balance Store</b>\n━━━━━━━━━━━━━━\nရွေးချယ်ပြီး Telegram Stars နဲ့ Balance ဝယ်ယူနိုင်ပါတယ်။\n\n<b>Package</b>\n⭐ 10 Stars\n⭐ 20 Stars\n⭐ 30 Stars\n⭐ 40 Stars\n⭐ 50 Stars\n⭐ 100 Stars\n\n💡 <b>Rate:</b> 1 Star = ${fmt(env.BAL_PER_STAR)} ${COIN}`;}
function parsePayload(payload){const parts=String(payload||'').split(':');if(parts.length!==3||parts[0]!==STAR_PAYLOAD_PREFIX)return null;const stars=Number(parts[2]);const userId=String(parts[1]);return STAR_PACKAGES.includes(stars)&&/^\d+$/.test(userId)?{stars,userId}:null;}

module.exports=bot=>{
  bot.command(['bal','balance','mybalance'],sendBalance);
  bot.hears(/^\.(bal|balance|mybalance)\s*$/i,sendBalance);

  bot.action('stars:menu',async ctx=>{await ctx.answerCbQuery();await ctx.reply(packageText(),{reply_markup:packageKeyboard()});});
  bot.action(/^stars:buy:(10|20|30|40|50|100)$/,async ctx=>{
    const stars=Number(ctx.match[1]);
    await ctx.answerCbQuery(`⭐ ${stars} Stars invoice`);
    const userId=String(ctx.from.id);
    const payload=`${STAR_PAYLOAD_PREFIX}:${userId}:${stars}`;
    try{
      await ctx.telegram.sendInvoice(ctx.from.id,{
        title:`BIKA Balance — ${stars} Stars`,
        description:`Add ${fmt(stars*env.BAL_PER_STAR)} ${COIN} to your BIKA balance.`,
        payload,
        currency:'XTR',
        prices:[{label:`${fmt(stars*env.BAL_PER_STAR)} ${COIN} Balance`,amount:stars}],
      });
    }catch(err){
      await ctx.reply('⚠️ Balance invoice ကို DM ထဲပို့လို့မရသေးပါ။ Bot ကို အရင် /start လုပ်ပြီး ပြန်ဝယ်ပေးပါ။');
    }
  });
  bot.action('stars:close',async ctx=>{await ctx.answerCbQuery();try{await ctx.deleteMessage();}catch(_){await ctx.editMessageReplyMarkup({inline_keyboard:[]}).catch(()=>{});}});

  bot.on('pre_checkout_query',async ctx=>{
    const q=ctx.update.pre_checkout_query;
    const order=parsePayload(q.invoice_payload);
    const valid=order&&String(q.from.id)===order.userId&&q.currency==='XTR'&&Number(q.total_amount)===order.stars;
    if(!valid)return ctx.answerPreCheckoutQuery(false,'Invalid or expired BIKA balance package.');
    return ctx.answerPreCheckoutQuery(true);
  });

  bot.on('successful_payment',async ctx=>{
    const payment=ctx.message?.successful_payment;
    const order=parsePayload(payment?.invoice_payload);
    if(!order||String(ctx.from.id)!==order.userId||payment.currency!=='XTR'||Number(payment.total_amount)!==order.stars){return ctx.reply('⚠️ Payment verification failed. Please contact support with your Telegram payment receipt.');}
    try{
      const balanceAmount=order.stars*env.BAL_PER_STAR;
      const result=await creditBalanceFromStars(ctx.from.id,balanceAmount,{
        paymentChargeId:payment.telegram_payment_charge_id,
        stars:order.stars,
        currency:payment.currency,
        telegramPaymentId:payment.telegram_payment_charge_id,
      });
      if(result.duplicate)return;
      const user=await getUser(ctx.from.id);
      await ctx.reply(`✅ <b>Balance ဝယ်ယူမှု အောင်မြင်ပါပြီ</b>\n━━━━━━━━━━━━━━\n⭐ Paid: <b>${order.stars} Stars</b>\n💰 Added: <b>${fmt(balanceAmount)}</b> ${COIN}\n💳 Balance: <b>${fmt(user?.balance||0)}</b> ${COIN}\n━━━━━━━━━━━━━━` ,{parse_mode:'HTML'});
    }catch(err){
      console.error('[STARS_BALANCE_CREDIT_ERROR]',err);
      await ctx.reply('⚠️ Payment ရရှိပြီးပါပြီ။ Balance credit လုပ်ရာမှာ ခဏအခက်အခဲရှိနေပါတယ်။ Receipt ကို မဖျက်ပါနဲ့။');
    }
  });
};
module.exports.getBalanceRankLabel=()=>'';
