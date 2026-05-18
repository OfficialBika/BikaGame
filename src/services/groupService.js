const groupModel = require('../models/groupModel');
async function ensureGroup(chat){ if(!chat||!['group','supergroup'].includes(chat.type)) return null; const now=new Date(); await groupModel.collection().updateOne({groupId:chat.id},{$set:{groupId:chat.id,title:chat.title||'Untitled Group',username:chat.username?String(chat.username).toLowerCase():null,type:chat.type,updatedAt:now},$setOnInsert:{createdAt:now,approvalStatus:'pending',botIsAdmin:false,inviteLink:null}},{upsert:true}); return getGroup(chat.id); }
async function getGroup(groupId){ return groupModel.collection().findOne({groupId}); }
async function approve(groupId, by){ await groupModel.collection().updateOne({groupId},{$set:{approvalStatus:'approved',approvedAt:new Date(),approvedBy:by,updatedAt:new Date()}}); }
async function reject(groupId, by){ await groupModel.collection().updateOne({groupId},{$set:{approvalStatus:'rejected',rejectedAt:new Date(),rejectedBy:by,updatedAt:new Date()}}); }
async function setBotAdmin(groupId,on){ await groupModel.collection().updateOne({groupId},{$set:{botIsAdmin:!!on,updatedAt:new Date()}},{upsert:true}); }
module.exports = { ensureGroup, getGroup, approve, reject, setBotAdmin };
