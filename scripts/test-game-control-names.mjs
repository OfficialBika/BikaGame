import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'tgcloud/lib/gameControlNames.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const { parseGameToggle, normalizeGameKey } = await import(moduleUrl);

const cases = [
  ['/slot on', { game: 'slot', enabled: true }],
  ['.slot off', { game: 'slot', enabled: false }],
  ['/bj off', { game: 'blackjack', enabled: false }],
  ['.blackjack on', { game: 'blackjack', enabled: true }],
  ['/shan off', { game: 'shan', enabled: false }],
  ['.dice on', { game: 'dice', enabled: true }],
  ['/mine off', { game: 'mines', enabled: false }],
  ['/mines on', { game: 'mines', enabled: true }],
  ['/game off blackjack', { game: 'blackjack', enabled: false }],
  ['/off slot', { game: 'slot', enabled: false }],
  ['/on mines', { game: 'mines', enabled: true }],
];

for (const [input, expected] of cases) {
  assert.deepEqual(parseGameToggle(input), expected, 'toggle parse: ' + input);
}
for (const input of ['/on', '/off', '/game foo slot', '.slot 1000', '/dice 200']) {
  assert.equal(parseGameToggle(input), null, 'must not reinterpret as a game toggle: ' + input);
}
assert.equal(normalizeGameKey('BJ'), 'blackjack');
assert.equal(normalizeGameKey('mine'), 'mines');
assert.equal(normalizeGameKey('nonsense'), null);
console.log('Game-control parser tests passed (' + cases.length + ' positive cases, 5 negative cases).');
