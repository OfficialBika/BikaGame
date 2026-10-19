import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'tgcloud/lib/commandParser.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const { parseCommand } = await import(moduleUrl);

const cases = [
  ['/slot 100', { name: 'slot', args: '100' }],
  ['.slot 100', { name: 'slot', args: '100' }],
  ['.bj 500 room-1', { name: 'blackjack', args: '500 room-1' }],
  ['/blackjack@BikaGameBot 500 solo', { name: 'blackjack', args: '500 solo' }],
  ['.shan 1000 room-2', { name: 'shan', args: '1000 room-2' }],
  ['.dice 200', { name: 'dice', args: '200' }],
  ['.mine 100', { name: 'mines', args: '100' }],
  ['/mines 100', { name: 'mines', args: '100' }],
  ['.crash 100', { name: 'crash', args: '100' }],
];
for (const [input, expected] of cases) assert.deepEqual(parseCommand(input), expected, input);
for (const input of ['hello', '.broadcast all', '.admin']) {
  assert.equal(parseCommand(input), null, input + ' must not be parsed as a game command');
}
console.log('Game command parser tests passed (' + cases.length + ' positive cases, 3 negative cases).');
