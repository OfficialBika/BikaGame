function isGroupChat(ctx){ const t=ctx.chat?.type; return t==='group'||t==='supergroup'; }
function fullNameFromTg(tg){ return [tg?.first_name,tg?.last_name].filter(Boolean).join(' ').trim() || tg?.username || 'User'; }
function mentionHtml(tg){ const { escHtml } = require('./format'); const name=fullNameFromTg(tg); return tg?.id ? `<a href="tg://user?id=${tg.id}">${escHtml(name)}</a>` : `<b>${escHtml(name)}</b>`; }
function userDocLabelHtml(u){ const { escHtml } = require('./format'); const name=[u?.firstName,u?.lastName].filter(Boolean).join(' ').trim() || u?.username || 'User'; return u?.userId ? `<a href="tg://user?id=${u.userId}">${escHtml(name)}</a>` : `<b>${escHtml(name)}</b>`; }
function parseAmount(text){ const parts=String(text||'').trim().split(/\s+/); for(let i=1;i<parts.length;i++){ const t=parts[i].replace(/,/g,''); if(/^\d+(\.\d+)?$/.test(t)) return Number(t); } return null; }
function parseMentionUsername(text){ const p=String(text||'').split(/\s+/).find(x=>x.startsWith('@')&&x.length>1); return p?p.slice(1).toLowerCase():null; }
function randInt(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
function startOfDayYangon(d){ const offset=6.5*3600*1000; const local=new Date(d.getTime()+offset); local.setUTCHours(0,0,0,0); return new Date(local.getTime()-offset); }
function isCommandLikeText(text=''){ return /^([/.])\S+/.test(String(text||'').trim()); }
module.exports = { isGroupChat, fullNameFromTg, mentionHtml, userDocLabelHtml, parseAmount, parseMentionUsername, randInt, sleep, startOfDayYangon, isCommandLikeText };
