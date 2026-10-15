import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const files = [new URL('public/miniapp/app.js', root), new URL('public/miniapp/app-core.js', root)];

const endpointMap = {
  '/api/mini/config':'getConfig',
  '/api/mini/me':'me',
  '/api/mini/history':'history',
  '/api/mini/wallet':'wallet',
  '/api/mini/wallet/lookup':'walletLookup',
  '/api/mini/wallet/transfer':'walletTransfer',
  '/api/mini/slot/spin':'slotSpin',
  '/api/mini/plinko/drop':'plinkoDrop',
  '/api/mini/wheel/daily-status':'wheelDailyStatus',
  '/api/mini/wheel/daily-spin':'wheelDailySpin',
  '/api/mini/wheel/spin':'wheelSpin',
  '/api/mini/crash/start':'crashStart',
  '/api/mini/crash/bet':'crashBet',
  '/api/mini/crash/status':'crashStatus',
  '/api/mini/crash/cashout':'crashCashout',
  '/api/mini/mines/start':'minesStart',
  '/api/mini/mines/status':'minesStatus',
  '/api/mini/mines/open':'minesOpen',
  '/api/mini/mines/cashout':'minesCashout',
  '/api/mini/blackjack/status':'blackjackStatus',
  '/api/mini/blackjack/join':'blackjackJoin',
  '/api/mini/blackjack/hit':'blackjackHit',
  '/api/mini/blackjack/stand':'blackjackStand',
  '/api/mini/shan/create':'shanCreate',
  '/api/mini/shan/status':'shanStatus',
  '/api/mini/shan/join':'shanJoin',
  '/api/mini/shan/draw':'shanDraw',
  '/api/mini/shan/stay':'shanStay',
  '/api/mini/shan/deal':'shanDeal',
  '/api/mini/background-music':'backgroundMusic',
};

const mapLiteral = JSON.stringify(endpointMap);
const helper = `\nasync function serverlessCall(path, body = {}) {\n  const endpointMap = ${mapLiteral};\n  const name = endpointMap[path];\n  if (!name) throw new Error('Serverless endpoint not mapped: ' + path);\n  return new Promise((resolve, reject) => {\n    const call = window.Telegram?.WebApp?.Serverless?.call;\n    if (typeof call !== 'function') { reject(new Error('Telegram Serverless API unavailable')); return; }\n    call(name, body, (error, result) => {\n      if (error) { const e = new Error(error.message || 'Serverless request failed'); e.payload = error.parameters || {}; reject(e); return; }\n      resolve(result);\n    });\n  });\n}\n`;

let changed = false;
for (const file of files) {
  let text = fs.readFileSync(file, 'utf8');
  if (file.pathname.endsWith('/app-core.js')) {
    const old = `async function api(path, body = {}) {\n  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData }, body: JSON.stringify(body) });\n  const data = await res.json().catch(() => ({}));\n  if (!res.ok || data.ok === false) { const err = new Error(data.message || data.error || 'Request failed'); err.payload = data; throw err; }\n  return data;\n}`;
    if (!text.includes('async function serverlessCall(path')) text = text.replace(old, helper + '\nasync function api(path, body = {}) { return serverlessCall(path, body); }');
    text = text.replace("const res = await fetch('/api/mini/config', { cache: 'no-store' });\n  config = await res.json();", "config = await serverlessCall('/api/mini/config');");
  } else {
    const old = `api=async(path,body={})=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify(body)}),d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.message||d.error||'Request failed');return d}`;
    if (!text.includes('async function serverlessCall(path')) text = text.replace(old, `serverlessCall=async(path,body={})=>{const m=${mapLiteral},name=m[path];if(!name)throw new Error('Serverless endpoint not mapped: '+path);return new Promise((resolve,reject)=>{const call=window.Telegram?.WebApp?.Serverless?.call;if(typeof call!=='function')return reject(new Error('Telegram Serverless API unavailable'));call(name,body,(e,d)=>e?reject(new Error(e.message||'Serverless request failed')):resolve(d))})},api=async(path,body={})=>serverlessCall(path,body)`);
    text = text.replace("fetch('/api/mini/background-music',{headers:{'X-Telegram-Init-Data':initData}})", "serverlessCall('/api/mini/background-music').then(d=>({ok:true,json:async()=>d}))");
  }
  if (text !== fs.readFileSync(file, 'utf8')) { fs.writeFileSync(file, text); changed = true; }
}
console.log(changed ? 'Mini App Serverless API patch applied.' : 'Mini App already patched or no matching legacy API block found.');
