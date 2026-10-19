import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';

const root = process.cwd();
async function jsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await jsFiles(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const files = await jsFiles(join(root, 'tgcloud'));
for (const file of files) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (spec === 'sdk' || spec.startsWith('sdk/')) continue;
    assert.ok(spec.startsWith('.'), file + ': unsupported runtime import ' + spec);
    const target = resolve(dirname(file), spec);
    assert.ok(target.startsWith(resolve(root, 'tgcloud') + '/'), file + ': import escapes tgcloud');
    await stat(target);
  }
}

const game = await readFile(join(root, 'tgcloud/lib/game.js'), 'utf8');
const economy = await readFile(join(root, 'tgcloud/lib/economy.js'), 'utf8');
const mini = await readFile(join(root, 'tgcloud/lib/mini.js'), 'utf8');
const schema = await readFile(join(root, 'tgcloud/schema.js'), 'utf8');
assert.match(game, /settleSingleGame/);
assert.match(game, /playSlot/);
assert.match(game, /playPlinko/);
assert.match(game, /wheelDailyStatus/);
assert.doesNotMatch(game, /db\.update\(users\)\.set\(\{\s*balance/);
assert.match(economy, /CREATE TRIGGER IF NOT EXISTS bika_transactions_after_insert/);
assert.match(economy, /idempotencyKeys/);
assert.match(economy, /required_balance/);
assert.match(mini, /case 'walletTransfer':[\s\S]*transferByWalletId/);
assert.match(schema, /table\('two_d_events'/);
assert.match(schema, /table\('sports_bets'/);
assert.match(schema, /table\('shop_cards'/);
assert.match(schema, /table\('auctions'/);
console.log('Serverless V2 static contract checks passed (' + files.length + ' backend modules).');
