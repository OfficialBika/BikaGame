'use strict';
const { COIN } = require('../../config/constants');
const { getUser } = require('../../services/economyService');
const { replyHTML } = require('../../utils/telegram');
const { fmt } = require('../../utils/format');
const { mentionHtml } = require('../../utils/helpers');
const { getBalanceRank } = require('../../utils/ranking');
const { getBotInfo } = require('../../config/bot');
const { walletIdForUserId, getWallet } = require('../../services/walletService');
function replyOptions(ctx){const messageId=ctx.message?.message_id;return messageId?{reply_to_message_id:messageId,allow_sending_without_reply:true}:{};}
async function payKeyboard(ctx){const username=String(getBotInfo()?.username||process.env.BOT_USERNAME||'').replace(/^@/,'');if(!username||!ctx.from?.id)return undefined;const wallet=await getWallet(ctx.from.id);if(!wallet?.walletId)return undefined;const deep=`https://t.me/${username}?startapp=${encodeURIComponent(`pay_${wallet.walletId}`)}`;return {inline_keyboard:[[{text:'💸 Pay Bal',style:'primary',url:deep}]]};}
function balanceText(ctx,u){const balance=Number(u?.balance||0),totalWon=Number(u?.totalWon||0),totalLost=Number(u?.totalLost||0),r=getBalanceRank(u?.balance);return `${r.badge} <b>BIKA Wallet</b>\n━━━━━━━━━━━━━━\n👤 ${mentionHtml(ctx.from)}\n💰 Balance: <b>${fmt(balance)}</b> ${COIN}\n🏆 Total Won: <b>${fmt(totalWon)}</b> ${COIN}\n💸 Total Lost: <b>${fmt(totalLost)}</b> ${COIN}\n🏷️ Rank: <b>${r.title}</b>\n━━━━━━━━━━━━━━`;}
async function sendBalance(ctx){const u=await getUser(ctx.from.id);const keyboard=await payKeyboard(ctx);return replyHTML(ctx,balanceText(ctx,u),{...replyOptions(ctx),reply_markup:keyboard});}
module.exports=bot=>{bot.command(['bal','balance','mybalance'],sendBalance);bot.hears(/^\.(bal|balance|mybalance)\s*$/i,sendBalance);};
module.exports.getBalanceRankLabel=()=>'';
