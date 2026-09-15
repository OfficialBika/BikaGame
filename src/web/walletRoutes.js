'use strict';
const { ensureUser, getUser } = require('../services/economyService');
const { verifyTelegramMiniAppInitData, getInitDataFromRequest } = require('./telegramMiniAuth');
const { getWallet, lookupWallet, transferByWallet } = require('../services/walletService');
function auth(req,res,next){try{const initData=getInitDataFromRequest(req);const a=verifyTelegramMiniAppInitData(initData);req.telegramUser=a.user;return next();}catch(err){const code=String(err?.message||err);const map={MINIAPP_AUTH_MISSING:[401,'Telegram login missing. Open this page from Telegram.'],MINIAPP_AUTH_INVALID:[401,'Telegram login invalid.'],MINIAPP_AUTH_EXPIRED:[401,'Telegram login expired. Please reopen the Mini App.']};const [status,message]=map[code]||[401,'Telegram authentication failed.'];return res.status(status).json({ok:false,error:code,message});}}
function tgUser(u){return {id:u.id,username:u.username||null,first_name:u.first_name||null,last_name:u.last_name||null,language_code:u.language_code||null,is_premium:!!u.is_premium,photo_url:u.photo_url||null};}
function sendError(res,err){const code=String(err?.message||err);const map={USER_NOT_FOUND:[404,'User data မတွေ့ပါ။ Bot ကို /start အရင်လုပ်ပါ။'],WALLET_INVALID:[400,'Wallet ID မမှန်ပါ။'],WALLET_NOT_FOUND:[404,'ဒီ Wallet ID ပိုင်ရှင်ကို မတွေ့ပါ။'],INVALID_TRANSFER_AMOUNT:[400,'Transfer amount မမှန်ပါ။'],TRANSFER_SELF:[400,'ကိုယ့် Wallet ကိုယ် ပြန်လွှဲလို့မရပါ။'],INSUFFICIENT:[400,'Balance မလုံလောက်ပါ။']};const [status,message]=map[code]||[500,'Wallet server error ဖြစ်နေပါတယ်။'];return res.status(status).json({ok:false,error:code,message});}
module.exports=function registerWalletRoutes(app){
 app.post('/api/mini/wallet',auth,async(req,res)=>{try{await ensureUser(tgUser(req.telegramUser));return res.json({ok:true,wallet:await getWallet(req.telegramUser.id)});}catch(err){return sendError(res,err);}});
 app.post('/api/mini/wallet/lookup',auth,async(req,res)=>{try{return res.json({ok:true,wallet:await lookupWallet(req.body?.walletId)});}catch(err){return sendError(res,err);}});
 app.post('/api/mini/wallet/transfer',auth,async(req,res)=>{try{await ensureUser(tgUser(req.telegramUser));const result=await transferByWallet(req.telegramUser.id,req.body?.walletId,req.body?.amount);return res.json({ok:true,...result});}catch(err){return sendError(res,err);}});
};
