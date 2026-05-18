const { ensureUser } = require('../services/economyService');
const { ensureGroup } = require('../services/groupService');
module.exports = async (ctx,next)=>{ try{ if(ctx.from?.id) await ensureUser(ctx.from); if(ctx.chat) await ensureGroup(ctx.chat); }catch(e){ console.error('userCheck',e); } return next(); };
