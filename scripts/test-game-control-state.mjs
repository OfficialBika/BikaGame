import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'tgcloud/lib/gameControlsPolicy.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const { enabledFromSetting } = await import(moduleUrl);

assert.equal(enabledFromSetting(true), true, 'legacy explicit ON remains enabled');
assert.equal(enabledFromSetting(false), false, 'explicit OFF stays disabled');
assert.equal(enabledFromSetting({ enabled: true }), true, 'audited ON record is enabled');
assert.equal(enabledFromSetting({ enabled: false }), false, 'audited OFF record is disabled');
assert.equal(enabledFromSetting({}), false, 'malformed saved object fails closed');
assert.equal(enabledFromSetting({ enabled: 'false' }), false, 'string booleans are not trusted');
assert.equal(enabledFromSetting('false'), false, 'malformed string state fails closed');
assert.equal(enabledFromSetting(null), false, 'null is not treated as enabled by the policy helper');

console.log('Game-control setting policy tests passed (valid states and malformed-state fail-closed).');
