const { env } = require('../config/env');
const { toNum } = require('../utils/format');
const treasuryModel = require('../models/treasuryModel');
async function ensureTreasury(){ const c=treasuryModel.collection(); const exist=await c.findOne({key:'treasury'}); if(exist){ const fixed={ totalSupply: toNum(exist.totalSupply), ownerBalance: toNum(exist.ownerBalance), ownerUserId: exist.ownerUserId || env.OWNER_ID, maintenanceMode: typeof exist.maintenanceMode==='boolean'?exist.maintenanceMode:false, vipWinRate: Number.isFinite(Number(exist.vipWinRate))?Math.max(0,Math.min(100,Math.floor(Number(exist.vipWinRate)))):90 }; await c.updateOne({key:'treasury'},{$set:{...fixed,updatedAt:new Date()}}); return c.findOne({key:'treasury'}); }
 await c.insertOne({key:'treasury',ownerUserId:env.OWNER_ID,totalSupply:0,ownerBalance:0,maintenanceMode:false,vipWinRate:90,broadcastRunning:false,createdAt:new Date(),updatedAt:new Date()}); return c.findOne({key:'treasury'}); }
async function getTreasury(){ return treasuryModel.collection().findOne({key:'treasury'}); }
function isOwner(ctx, t){ return !!(t?.ownerUserId && ctx.from?.id === t.ownerUserId); }
async function setTotalSupply(amount){ const amt=Math.max(0,Math.floor(toNum(amount))); await treasuryModel.collection().updateOne({key:'treasury'},{$set:{totalSupply:amt,ownerBalance:amt,updatedAt:new Date()}},{upsert:true}); }
async function setMaintenance(on){ await treasuryModel.collection().updateOne({key:'treasury'},{$set:{maintenanceMode:!!on,updatedAt:new Date()}},{upsert:true}); }
async function setVipWinRate(rate){ const n=Math.max(0,Math.min(100,Math.floor(Number(rate)))); await treasuryModel.collection().updateOne({key:'treasury'},{$set:{vipWinRate:n,updatedAt:new Date()}},{upsert:true}); return n; }
module.exports = { ensureTreasury, getTreasury, isOwner, setTotalSupply, setMaintenance, setVipWinRate };
