import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const cloudRoot = path.join(root, 'tgcloud');
const staticRoot = path.join(root, 'public', 'miniapp');
const required = [
  'schema.js',
  'lib/users.js',
  'handlers/message.js',
  'handlers/callback_query.js',
  'endpoints/getProfile.js',
  'endpoints/getLeaderboard.js',
];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) found.push(full);
  }
  return found;
}

async function walkStatic(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walkStatic(full));
    else if (entry.isFile() && /\.(?:html|js|css)$/i.test(entry.name)) found.push(full);
  }
  return found;
}

for (const relative of required) {
  await stat(path.join(cloudRoot, relative));
}

const modules = await walk(cloudRoot);
assert.ok(modules.length >= required.length, 'expected the Serverless module set to be present');

for (const file of modules) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(root, file);
  assert.match(source, /export\s+default\s+async\s+function|export\s+default\s+function|export\s+(?:const|function|async function)/,
    relative + ' must contain an explicit module export');
  assert.doesNotMatch(source, /\brequire\s*\(/, relative + ' must not use CommonJS require');
  assert.doesNotMatch(source, /\bprocess\.env\b|\bprocess\.exit\b/, relative + ' must not depend on Node process APIs');
  assert.doesNotMatch(source, /from\s+['"](?:node:|express|telegraf|mongodb|dotenv|fs|path|crypto)(?:['"/]|$)/,
    relative + ' imports an unsupported Node/npm runtime dependency');

  const localImports = source.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g);
  for (const match of localImports) {
    assert.ok(match[1].endsWith('.js'), relative + ' local import must end with .js: ' + match[1]);
    const target = path.resolve(path.dirname(file), match[1]);
    assert.ok(target.startsWith(cloudRoot + path.sep), relative + ' local import must stay within tgcloud/');
    await stat(target);
  }
}

const configText = await readFile(path.join(root, 'tgcloud.jsonc'), 'utf8');
const config = JSON.parse(configText);
assert.equal(config.static?.source, 'public/miniapp', 'Serverless static source must be public/miniapp');
assert.equal(config.static?.spa, true, 'Mini App should retain SPA fallback behavior');

const patcher = await readFile(path.join(root, 'scripts/patch-miniapp-serverless.mjs'), 'utf8');
const mapBlock = patcher.match(/const endpointMap\s*=\s*\{([\s\S]*?)\n\};/);
assert.ok(mapBlock, 'patch script must declare a Mini App endpoint map');
const mapEntries = [...mapBlock[1].matchAll(/['"]([^'"]+)['"]\s*:\s*['"]([A-Za-z0-9_]+)['"]/g)];
assert.ok(mapEntries.length > 0, 'endpoint map must not be empty');
const endpointMap = new Map(mapEntries.map((match) => [match[1], match[2]]));

for (const [apiPath, endpointName] of endpointMap) {
  assert.ok(apiPath.startsWith('/api/mini/'), 'unexpected legacy API key: ' + apiPath);
  await stat(path.join(cloudRoot, 'endpoints', endpointName + '.js'));
}

const frontendFiles = await walkStatic(staticRoot);
assert.ok(frontendFiles.some((file) => file === path.join(staticRoot, 'index.html')), 'Mini App index.html must exist');
const frontendSources = [];
for (const file of frontendFiles) {
  const source = await readFile(file, 'utf8');
  const relative = path.relative(root, file);
  frontendSources.push({ file, relative, source });

  assert.doesNotMatch(source, /fetch\s*\(\s*["']\/api\/mini\//,
    relative + ' must call Serverless endpoints rather than legacy Express API URLs');
  assert.doesNotMatch(source, /["']\/miniapp\/[^"']+\.(?:js|css|png|svg|webp|woff2?)(?:[?#][^"']*)?["']/i,
    relative + ' still contains an Express-prefixed static asset URL');
}

for (const file of ['public/miniapp/app.js', 'public/miniapp/app-core.js']) {
  const source = await readFile(path.join(root, file), 'utf8');
  assert.match(source, /Serverless\?\.call/, file + ' must invoke Telegram.WebApp.Serverless.call');
}

const allFrontendApiPaths = new Set();
for (const item of frontendSources) {
  for (const match of item.source.matchAll(/['"]\/api\/mini\/[^'"]+['"]/g)) {
    allFrontendApiPaths.add(match[0].slice(1, -1));
  }
}
const unmapped = [...allFrontendApiPaths].filter((apiPath) => !endpointMap.has(apiPath));
assert.deepEqual(unmapped, [], 'all Mini App /api/mini/* references must exist in the Serverless endpoint map');

const handler = await readFile(path.join(cloudRoot, 'handlers/message.js'), 'utf8');
assert.match(handler, /command\.name\s*===?\s*['"]balance['"]|c\.name\s*===?\s*['"]balance['"]|c\.name\s*===\s*['"]balance['"]/,
  'read-only balance preview command must be present');
assert.match(handler, /preview database|Preview database|Production balances and history have not been imported|Production MongoDB is never read/i,
  'preview must warn that production data is not migrated');

console.log('Serverless contract checks passed (' + modules.length + ' modules, ' + endpointMap.size + ' endpoint mappings, ' + frontendFiles.length + ' static files checked).');
