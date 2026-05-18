const { ensureTreasury, isOwner } = require('../services/treasuryService');
async function ownerOnly(ctx,next){ const t=await ensureTreasury(); if(!isOwner(ctx,t)) return ctx.reply('⛔ Owner only command.'); return next(); }
module.exports = { ownerOnly };
