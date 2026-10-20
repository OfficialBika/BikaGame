import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'tgcloud/lib/minesPolicy.js'), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const {
  MINES_RULES, normalizeMineCount, generateMineLayout, paidSafeOpened,
  calculateMinesMultiplier, canCashOutMines, minesExpiryTime, isMinesExpired,
} = await import(moduleUrl);

assert.equal(MINES_RULES.boardSize, 5);
assert.equal(MINES_RULES.defaultMineCount, 5);
assert.deepEqual(MINES_RULES.allowedMineCounts, [5, 7, 9, 10]);
assert.equal(MINES_RULES.minCashoutSafePicks, 4);
assert.equal(MINES_RULES.firstSafeFreePicks, 1);
assert.equal(MINES_RULES.actionTimeoutMs, 150000);
assert.equal(normalizeMineCount(undefined), 5);
assert.equal(normalizeMineCount('7'), 7);
assert.equal(normalizeMineCount('1,0'), 10);
assert.throws(() => normalizeMineCount('3'), /INVALID_MINE_COUNT/);
assert.throws(() => normalizeMineCount('25'), /INVALID_MINE_COUNT/);

function sequentialRandom() {
  let cursor = 0;
  return () => ((cursor++ % 25) + 0.1) / 25;
}
for (const count of MINES_RULES.allowedMineCounts) {
  const layout = generateMineLayout(count, 0, sequentialRandom());
  assert.equal(layout.length, count, 'every supported mine count must have exact number of mines');
  assert.equal(new Set(layout).size, count, 'mine cells must be unique');
  assert.ok(layout.every((index) => Number.isInteger(index) && index >= 0 && index < 25));
  assert.ok(!layout.includes(0), 'the first selected tile must be protected');
}
assert.equal(paidSafeOpened(0), 0);
assert.equal(paidSafeOpened(1), 0, 'first safe pick must be free');
assert.equal(paidSafeOpened(4), 3);

assert.equal(calculateMinesMultiplier(0, 5), 1);
assert.equal(calculateMinesMultiplier(1, 5), 1, 'first free safe tile cannot increase payout');
assert.equal(canCashOutMines(0), false);
assert.equal(canCashOutMines(1), false);
assert.equal(canCashOutMines(3), false);
assert.equal(canCashOutMines(4), true, 'cashout unlocks at four safe picks');
let prior = 0;
for (let picks = 0; picks <= 20; picks += 1) {
  const multiplier = calculateMinesMultiplier(picks, 5);
  assert.ok(Number.isFinite(multiplier) && multiplier >= 1 && multiplier <= MINES_RULES.maxPayoutMultiplier);
  assert.ok(multiplier >= prior, 'multiplier should not decrease as safe picks increase');
  prior = multiplier;
}
assert.equal(minesExpiryTime(1000), 151000);
assert.equal(isMinesExpired(151000, 150999), false);
assert.equal(isMinesExpired(151000, 151000), true);
assert.equal(isMinesExpired(null, 999999), false);

// Keep the pure policy tests tied to the actual production entry points, not just
// the helper module. These checks catch a future hardcoded rule in service code.
const gameSource = await readFile(resolve(root, 'tgcloud/lib/game.js'), 'utf8');
const botSource = await readFile(resolve(root, 'tgcloud/handlers/message.js'), 'utf8');
const miniSource = await readFile(resolve(root, 'tgcloud/lib/mini.js'), 'utf8');
assert.match(gameSource, /generateMineLayout\(mineCount, openedBefore\.length === 0 \? cell : null\)/);
assert.match(gameSource, /calculateMinesMultiplier\(opened\.length, mineCount\)/);
assert.match(gameSource, /canCashOutMines\(opened\.length\)/);
assert.match(gameSource, /minesExpiryTime\(startedAt\)/);
assert.doesNotMatch(gameSource, /minesLayout\(3\)|1 \+ opened\.length \* 0\.35/);
assert.match(botSource, /minesStart\(user\.tgId, bet, 'tg:' \+ chatId \+ ':' \+ message\.message_id, parsedArgs\[1\]\)/);
assert.match(miniSource, /minesStart\(userId, body\.bet, body\.requestId, body\.mineCount\)/);
console.log('Mines rules and service wiring tests passed (main defaults, first-safe pick, cashout gate, expiry and Telegram/Mini App inputs).');

