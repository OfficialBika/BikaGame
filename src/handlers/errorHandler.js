const logger = require('../utils/logger');
module.exports = (bot)=> bot.catch((err,ctx)=>{ logger.error('Bot error', err?.message || err); try{ ctx?.answerCbQuery?.('Error',{show_alert:false}); }catch(_){} });
