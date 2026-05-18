const { chance } = require('../services/vipService');

/**

Roll Dice using real Telegram dice.

@param {Object} ctx - Telegraf context

@param {Object} userA - challenger user object {isVip: boolean}

@param {Object} userB - target user object {isVip: boolean}

@param {number} rate - VIP win rate (default 90)

@returns {Promise<{d1:number,d2:number,winner:string}>} */ async function roll(ctx, userA, userB, rate = 90) { // Roll challenger dice using Telegram dice const sent1 = await ctx.telegram.sendDice(ctx.chat.id, { reply_to_message_id: ctx.message?.message_id }); const d1_raw = sent1.dice?.value || 1; // fallback 1 if null


// Roll target dice using Telegram dice const sent2 = await ctx.telegram.sendDice(ctx.chat.id, { reply_to_message_id: ctx.message?.message_id }); const d2_raw = sent2.dice?.value || 1;

let d1 = d1_raw; let d2 = d2_raw;

const vipA = !!userA?.isVip; const vipB = !!userB?.isVip; const vipChance = chance(rate);

// Adjust dice for VIP advantage if (vipA && !vipB && Math.random() < vipChance) { if (d1 <= d2) d1 = Math.min(6, d2 + 1); // boost challenger } else if (vipB && !vipA && Math.random() < vipChance) { if (d2 <= d1) d2 = Math.min(6, d1 + 1); // boost target }

let winner = 'TIE'; if (d1 > d2) winner = 'A'; else if (d2 > d1) winner = 'B';

return { d1, d2, winner }; }

module.exports = { roll };
