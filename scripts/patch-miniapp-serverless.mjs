import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootUrl = new URL('..', import.meta.url);
const rootPath = fileURLToPath(rootUrl);
const staticRoot = path.join(rootPath, 'public', 'miniapp');
const appFile = path.join(staticRoot, 'app.js');
const coreFile = path.join(staticRoot, 'app-core.js');

function collectStaticFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectStaticFiles(full));
    } else if (entry.isFile() && /\.(?:html|js|css)$/i.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

const files = collectStaticFiles(staticRoot);
if (!files.includes(appFile) || !files.includes(coreFile) || !files.includes(path.join(staticRoot, 'index.html'))) {
  throw new Error('Mini App source is incomplete: expected index.html, app.js and app-core.js.');
}

const endpointMap = {
  '/api/mini/config': 'getConfig',
  '/api/mini/me': 'me',
  '/api/mini/history': 'history',
  '/api/mini/wallet': 'wallet',
  '/api/mini/wallet/lookup': 'walletLookup',
  '/api/mini/wallet/transfer': 'walletTransfer',
  '/api/mini/wallet/transfers': 'walletTransfers',
  '/api/mini/slot/spin': 'slotSpin',
  '/api/mini/plinko/drop': 'plinkoDrop',
  '/api/mini/wheel/daily-status': 'wheelDailyStatus',
  '/api/mini/wheel/daily-spin': 'wheelDailySpin',
  '/api/mini/wheel/spin': 'wheelSpin',
  '/api/mini/crash/start': 'crashStart',
  '/api/mini/crash/bet': 'crashBet',
  '/api/mini/crash/status': 'crashStatus',
  '/api/mini/crash/cashout': 'crashCashout',
  '/api/mini/mines/start': 'minesStart',
  '/api/mini/mines/status': 'minesStatus',
  '/api/mini/mines/open': 'minesOpen',
  '/api/mini/mines/cashout': 'minesCashout',
  '/api/mini/blackjack/status': 'blackjackStatus',
  '/api/mini/blackjack/join': 'blackjackJoin',
  '/api/mini/blackjack/hit': 'blackjackHit',
  '/api/mini/blackjack/stand': 'blackjackStand',
  '/api/mini/shan/create': 'shanCreate',
  '/api/mini/shan/status': 'shanStatus',
  '/api/mini/shan/join': 'shanJoin',
  '/api/mini/shan/draw': 'shanDraw',
  '/api/mini/shan/stay': 'shanStay',
  '/api/mini/shan/deal': 'shanDeal',
  '/api/mini/background-music': 'backgroundMusic',
};

const mapLiteral = JSON.stringify(endpointMap);
const helper = [
  '',
  'async function serverlessCall(path, body = {}) {',
  '  const endpointMap = __ENDPOINT_MAP__;',
  '  const name = endpointMap[path];',
  '  if (!name) throw new Error("Serverless endpoint not mapped: " + path);',
  '  return new Promise((resolve, reject) => {',
  '    const call = window.Telegram?.WebApp?.Serverless?.call;',
  '    if (typeof call !== "function") {',
  '      reject(new Error("Telegram Serverless API unavailable"));',
  '      return;',
  '    }',
  '    call(name, body, (error, result) => {',
  '      if (error) {',
  '        const e = new Error(error.message || "Serverless request failed");',
  '        e.type = error.type;',
  '        e.status = error.status;',
  '        e.payload = error.parameters || {};',
  '        reject(e);',
  '        return;',
  '      }',
  '      resolve(result);',
  '    });',
  '  });',
  '}',
  ''
].join('\n').replace('__ENDPOINT_MAP__', mapLiteral);

const oldCoreApi = "async function api(path, body = {}) {\n  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData }, body: JSON.stringify(body) });\n  const data = await res.json().catch(() => ({}));\n  if (!res.ok || data.ok === false) { const err = new Error(data.message || data.error || 'Request failed'); err.payload = data; throw err; }\n  return data;\n}";
const oldAppApi = "api=async(path,body={})=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify(body)}),d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.message||d.error||'Request failed');return d}";

let changed = false;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  let text = original;

  if (file === coreFile) {
    if (!text.includes('async function serverlessCall(path')) {
      if (!text.includes(oldCoreApi)) {
        throw new Error('Cannot safely patch app-core.js: expected the legacy API helper or an existing Serverless adapter.');
      }
      text = text.replace(oldCoreApi, helper + '\nasync function api(path, body = {}) { return serverlessCall(path, body); }');
    }

    const oldConfigFetch = "const res = await fetch('/api/mini/config', { cache: 'no-store' });\n  config = await res.json();";
    if (text.includes(oldConfigFetch)) {
      text = text.replace(oldConfigFetch, "config = await serverlessCall('/api/mini/config');");
    } else if (!text.includes("serverlessCall('/api/mini/config')")) {
      throw new Error('Cannot safely patch app-core.js: the config request has changed and must be reviewed.');
    }
  } else if (file === appFile) {
    if (!text.includes('Serverless?.call')) {
      if (!text.includes(oldAppApi)) {
        throw new Error('Cannot safely patch app.js: expected the legacy API helper or an existing Serverless adapter.');
      }
      const replacement = 'serverlessCall=async(path,body={})=>{const m=' + mapLiteral + ',name=m[path];if(!name)throw new Error("Serverless endpoint not mapped: "+path);return new Promise((resolve,reject)=>{const call=window.Telegram?.WebApp?.Serverless?.call;if(typeof call!=="function")return reject(new Error("Telegram Serverless API unavailable"));call(name,body,(e,d)=>{if(e){const x=new Error(e.message||"Serverless request failed");x.type=e.type;x.status=e.status;x.payload=e.parameters||{};reject(x)}else resolve(d)})})},api=async(path,body={})=>serverlessCall(path,body)';
      text = text.replace(oldAppApi, replacement);
    }

    const oldMusicFetch = "fetch('/api/mini/background-music',{headers:{'X-Telegram-Init-Data':initData}})";
    if (text.includes(oldMusicFetch)) {
      text = text.replace(oldMusicFetch, "serverlessCall('/api/mini/background-music').then(d=>({ok:true,json:async()=>d}))");
    } else if (/fetch\(\s*["']\/api\/mini\/background-music/.test(text)) {
      throw new Error('Cannot safely patch app.js: legacy background-music fetch remains in an unexpected form.');
    }
  }

  // Serverless static hosting serves the Mini App directory from the domain root.
  // Legacy Express used /miniapp/ as a URL prefix. Rewrite root asset paths in
  // HTML, JS and CSS while keeping /api/mini/* API identifiers unchanged.
  text = text.replaceAll('/miniapp/', '/');

  if (/fetch\s*\(\s*["']\/api\/mini\//.test(text)) {
    throw new Error('Legacy direct API fetch remains after patch: ' + path.relative(rootPath, file));
  }

  if (text !== original) {
    fs.writeFileSync(file, text);
    changed = true;
  }
}

const app = fs.readFileSync(appFile, 'utf8');
const core = fs.readFileSync(coreFile, 'utf8');
if (!app.includes('Serverless?.call') || !core.includes('Serverless?.call')) {
  throw new Error('Mini App Serverless adapter verification failed.');
}
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (/["']\/miniapp\/[^"']+\.(?:js|css|png|svg|webp|woff2?)(?:[?#][^"']*)?["']/i.test(text)) {
    throw new Error('Legacy /miniapp/ static asset path remains in ' + path.relative(rootPath, file));
  }
}

console.log(changed
  ? 'Mini App Serverless API and root asset paths patched and verified.'
  : 'Mini App Serverless API and root asset paths already patched.');
