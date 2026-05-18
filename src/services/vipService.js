const userModel = require('../models/userModel');
async function setVip(userId,on){ await userModel.collection().updateOne({userId},{$set:{isVip:!!on,updatedAt:new Date()},$setOnInsert:{createdAt:new Date(),balance:0}},{upsert:true}); }
async function listVip(){ return userModel.collection().find({isVip:true}).sort({updatedAt:-1}).limit(100).toArray(); }
function chance(rate){ return Math.max(0,Math.min(100,Number(rate)||90))/100; }
module.exports = { setVip, listVip, chance };
