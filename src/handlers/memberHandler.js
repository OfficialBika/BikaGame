const { setBotAdmin, ensureGroup } = require('../services/groupService');
module.exports = (bot)=> bot.on('my_chat_member', async(ctx,next)=>{ const upd=ctx.update?.my_chat_member; const chat=upd?.chat; if(!chat||!['group','supergroup'].includes(chat.type)) return next(); await ensureGroup(chat); await setBotAdmin(chat.id, upd?.new_chat_member?.status === 'administrator'); return next(); });
