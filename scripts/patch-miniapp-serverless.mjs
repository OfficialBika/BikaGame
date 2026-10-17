import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootPath = fileURLToPath(new URL('..', import.meta.url));
const staticRoot = path.join(rootPath, 'public', 'miniapp');
const appFile = path.join(staticRoot, 'app.js');
const coreFile = path.join(staticRoot, 'app-core.js');
const renderApiBase = 'https://bikagamebot.onrender.com';

function collectStaticFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectStaticFiles(full));
    else if (entry.isFile() && /\.(?:html|js|css)$/i.test(entry.name)) files.push(full);
  }
  return files;
}

const files = collectStaticFiles(staticRoot);
if (!files.includes(appFile) || !files.includes(coreFile) || !files.includes(path.join(staticRoot, 'index.html'))) {
  throw new Error('Mini App source is incomplete: expected index.html, app.js and app-core.js.');
}

const endpointMap = {
  '/api/mini/config': 'getConfig',
  '/api/mini/features': 'featureStatus',
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
const bridgeInit = "window.BIKA_MINIAPP_API_BASE = window.BIKA_MINIAPP_API_BASE || '" + renderApiBase + "';";

const coreApi = [
  'async function api(path, body = {}) {',
  '  if (!Object.prototype.hasOwnProperty.call(miniAppEndpointMap, path)) throw new Error("Mini App API not mapped: " + path);',
  "  const method = path === '/api/mini/config' ? 'GET' : 'POST';",
  "  const options = method === 'GET' ? { method, cache: 'no-store' } : { method, headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData }, body: JSON.stringify(body) };",
  '  const base = window.BIKA_MINIAPP_API_BASE || "' + renderApiBase + '";',
  '  const res = await fetch(base + path, options);',
  '  const data = await res.json().catch(() => ({}));',
  "  if (!res.ok || data.ok === false) { const err = new Error(data.message || data.error || 'Request failed'); err.payload = data; throw err; }",
  '  return data;',
  '}'
].join('\n');

const oldCoreApi = "async function api(path, body = {}) {\n  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': initData }, body: JSON.stringify(body) });\n  const data = await res.json().catch(() => ({}));\n  if (!res.ok || data.ok === false) { const err = new Error(data.message || data.error || 'Request failed'); err.payload = data; throw err; }\n  return data;\n}";
const oldAppApi = "api=async(path,body={})=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify(body)}),d=await r.json();if(!r.ok||d.ok===false)throw new Error(d.message||d.error||'Request failed');return d}";
const appApi = "api=async(path,body={})=>{if(!Object.prototype.hasOwnProperty.call(miniAppEndpointMap,path))throw new Error('Mini App API not mapped: '+path);const method=path==='/api/mini/config'?'GET':'POST',base=window.BIKA_MINIAPP_API_BASE||'" + renderApiBase + "',options=method==='GET'?{method,cache:'no-store'}:{method,headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify(body)},r=await fetch(base+path,options),d=await r.json().catch(()=>({}));if(!r.ok||d.ok===false)throw new Error(d.message||d.error||'Request failed');return d}";

let changed = false;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  let text = original;

  if (file === coreFile) {
    if (text.includes('Serverless?.call')) {
      throw new Error('Old Serverless adapter is present in app-core.js. Restore public/miniapp tracked files, then rerun this bridge patch.');
    }
    if (!text.includes(bridgeInit)) {
      text = bridgeInit + '\nconst miniAppEndpointMap = ' + mapLiteral + ';\n' + text;
    } else {
      text = text.replace(/const miniAppEndpointMap\s*=\s*\{[^;]*\};/, 'const miniAppEndpointMap = ' + mapLiteral + ';');
    }

    if (text.includes(oldCoreApi)) {
      text = text.replace(oldCoreApi, coreApi);
    } else {
      const apiBlock = text.match(/async function api\(path, body = \{\}\) \{[\s\S]*?\n\}/);
      if (!apiBlock) throw new Error('Cannot safely patch app-core.js: API helper not found.');
      text = text.replace(apiBlock[0], coreApi);
    }

    text = text.replaceAll("fetch('/api/mini/config'", "fetch((window.BIKA_MINIAPP_API_BASE || '" + renderApiBase + "') + '/api/mini/config'");
  } else if (file === appFile) {
    if (text.includes('Serverless?.call')) {
      throw new Error('Old Serverless adapter is present in app.js. Restore public/miniapp tracked files, then rerun this bridge patch.');
    }
    if (text.includes('(()=>{const tg=')) {
      text = text.replace('(()=>{const tg=', '(()=>{' + bridgeInit + 'const miniAppEndpointMap=' + mapLiteral + ';const tg=');
    } else {
      if (!text.includes('miniAppEndpointMap=')) throw new Error('Cannot safely patch app.js: initialization point not found.');
      text = text.replace(/const miniAppEndpointMap=\{[^;]*\};/, 'const miniAppEndpointMap=' + mapLiteral + ';');
    }

    if (text.includes(oldAppApi)) {
      text = text.replace(oldAppApi, appApi);
    } else if (!text.includes('fetch(base+path,options)') && !text.includes('fetch(base+path,options)')) {
      if (!text.includes("fetch(base+path,options)")) {
        throw new Error('Cannot safely patch app.js: the legacy API helper is not present. Restore public/miniapp/app.js and rerun this bridge patch.');
      }
    }

    const oldMusicFetch = "fetch('/api/mini/background-music',{headers:{'X-Telegram-Init-Data':initData}})";
    if (text.includes(oldMusicFetch)) {
      text = text.replace(oldMusicFetch, "fetch((window.BIKA_MINIAPP_API_BASE||'" + renderApiBase + "')+'/api/mini/background-music',{headers:{'X-Telegram-Init-Data':initData}})");
    }
  }

  // Telegram Serverless static hosting serves this folder from the domain root.
  text = text.replaceAll('/miniapp/', '/');

  if (/fetch\s*\(\s*["']\/api\/mini\//.test(text)) {
    throw new Error('Relative Mini App API fetch remains after patch: ' + path.relative(rootPath, file));
  }

  if (text !== original) {
    fs.writeFileSync(file, text);
    changed = true;
  }
}

const app = fs.readFileSync(appFile, 'utf8');
const core = fs.readFileSync(coreFile, 'utf8');
for (const [name, source] of [['app.js', app], ['app-core.js', core]]) {
  if (!source.includes('BIKA_MINIAPP_API_BASE') || !source.includes(renderApiBase)) {
    throw new Error(name + ' is not configured for the production Render API bridge.');
  }
  if (source.includes('Serverless?.call')) {
    throw new Error(name + ' still calls the preview Serverless API.');
  }
}
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (/["']\/miniapp\/[^"']+\.(?:js|css|png|svg|webp|woff2?)(?:[?#][^"']*)?["']/i.test(text)) {
    throw new Error('Legacy /miniapp/ static asset path remains in ' + path.relative(rootPath, file));
  }
}

console.log(changed
  ? 'Mini App patched to use the MongoDB-backed Render API; root asset paths verified.'
  : 'Mini App Render API bridge and root asset paths already patched.');
