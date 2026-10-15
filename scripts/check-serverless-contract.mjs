import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const cloudRoot = path.join(root, 'tgcloud');
const required = [
  'schema.js',
  'lib/users.js',
  'handlers/message.js',
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
  }
}

const config = await readFile(path.join(root, 'tgcloud.jsonc'), 'utf8');
assert.doesNotMatch(config, /["']static["']\s*:/,
  'Do not publish the existing Express-dependent Mini App until its routes are ported');

const handler = await readFile(path.join(cloudRoot, 'handlers/message.js'), 'utf8');
assert.match(handler, /command\.name === 'balance'/, 'read-only balance preview command must be present');
assert.match(handler, /Production balances and history have not been imported/,
  'preview must warn that production data is not migrated');

console.log('Serverless module contract checks passed (' + modules.length + ' modules).');
