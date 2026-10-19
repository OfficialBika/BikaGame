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
const duelPlan = await readFile(join(root, 'tgcloud/lib/duelSettlementPlan.js'), 'utf8');
const diceDuel = await readFile(join(root, 'tgcloud/lib/diceDuel.js'), 'utf8');
const mini = await readFile(join(root, 'tgcloud/lib/mini.js'), 'utf8');
const schema = await readFile(join(root, 'tgcloud/schema.js'), 'utf8');
const message = await readFile(join(root, 'tgcloud/handlers/message.js'), 'utf8');
const callbacks = await readFile(join(root, 'tgcloud/handlers/callback_query.js'), 'utf8');
const stars = await readFile(join(root, 'tgcloud/lib/stars.js'), 'utf8');
const preCheckout = await readFile(join(root, 'tgcloud/handlers/pre_checkout_query.js'), 'utf8');
const parity = await readFile(join(root, 'docs/SERVERLESS_V2_PARITY.md'), 'utf8');
const featureStatus = await readFile(join(root, 'tgcloud/lib/featureStatus.js'), 'utf8');
const controls = await readFile(join(root, 'tgcloud/lib/gameControls.js'), 'utf8');
const config = await readFile(join(root, 'tgcloud/lib/config.js'), 'utf8');
const controlNames = await readFile(join(root, 'tgcloud/lib/gameControlNames.js'), 'utf8');
const miniHandler = await readFile(join(root, 'tgcloud/lib/mini.js'), 'utf8');

// V2 must keep production cutover explicitly blocked until main parity and import are proven.
assert.match(parity, /Production status: BLOCKED/);
for (const gameName of ['slot', 'bj', 'shan', 'dice', 'mine']) assert.ok(parity.includes('`/' + gameName + ' on|off`'), 'missing switch contract for ' + gameName);
for (const phrase of ['Auction', '2D', 'Broadcast', 'Group approval', 'Data import', 'rollback']) assert.ok(parity.toLowerCase().includes(phrase.toLowerCase()), 'missing parity gate: ' + phrase);

// Feature metadata must accurately mark unfinished domains and the non-production environment.
assert.match(featureStatus, /productionDataImported: false/);
assert.match(featureStatus, /productionCutoverApproved: false/);
assert.match(featureStatus, /status: 'BLOCKED'/);
for (const status of ['not-ported', 'schema-only', 'preview-only']) assert.ok(featureStatus.includes(status), 'missing explicit incomplete status: ' + status);
assert.match(featureStatus, /\.dice on\/off/);
assert.match(featureStatus, /Broadcast text\/copy/);
assert.match(featureStatus, /2D betting schedule and settlement/);

// Owner-only switches must be persisted and enforced at both bot and Mini App entry points.
assert.match(controls, /getSetting/);
assert.match(controls, /setSetting/);
assert.doesNotMatch(controls, /process\.env/);
assert.match(controls, /SERVERLESS_OWNER_TELEGRAM_ID/);
assert.match(config, /SERVERLESS_OWNER_TELEGRAM_ID = 0/);
assert.match(controls, /OWNER_ONLY/);
assert.match(controlNames, /function parseGameToggle/);
assert.match(controlNames, /blackjack/);
assert.match(controlNames, /mines/);
for (const gameName of ['slot', 'mines', 'blackjack', 'shan']) assert.ok(miniHandler.includes("assertGameEnabled('" + gameName + "')"), 'Mini App entry is missing the ' + gameName + ' switch');
assert.ok(message.includes('parseGameToggle(message.text)'), 'bot handler must parse per-game controls');
assert.ok(message.includes("assertGameEnabled('slot')"), 'slot command must honor its switch');
assert.ok(message.includes("assertGameEnabled('mines')"), 'mines command must honor its switch');
assert.ok(message.includes("assertGameEnabled('blackjack')"), 'blackjack command must honor its switch');
assert.ok(message.includes("assertGameEnabled('shan')"), 'shan command must honor its switch');
assert.ok(message.includes("assertGameEnabled('dice')"), 'dice challenge must honor its switch');
assert.match(callbacks, /game === 'dice'/, 'Dice accept/cancel callbacks must be wired');
assert.match(callbacks, /api\\.sendDice/, 'Dice must use real Telegram dice values');
assert.match(callbacks, /settleDiceChallenge/, 'Dice callback must use resumable settlement');
assert.match(diceDuel, /CHALLENGE_TIMEOUT_MS = 60000/);
assert.match(diceDuel, /status = 'rolling'/);
assert.match(economy, /buildDuelSettlementRow/);
assert.match(economy, /REFUND_USER_NOT_FOUND/);
assert.match(economy, /json_each\\(NEW\\.refunds\\)/);
assert.match(duelPlan, /__settlement:/);
assert.match(duelPlan, /fromAccountUserId: target/);
assert.equal((message.match(/\\\\n(?:Stars|Added|Balance|Rate):/g) || []).length, 0, 'messages must not print escaped literal \\n sequences');

// Existing features must preserve one-write settlement and idempotency guards.
assert.match(game, /settleSingleGame/);
assert.match(game, /playSlot/);
assert.match(game, /playPlinko/);
assert.match(game, /wheelDailyStatus/);
assert.doesNotMatch(game, /const user = await recordGame/);
assert.doesNotMatch(game, /const u=await recordGame/);
assert.match(game, /return \{ ok: true, cashedOut: true, multiplier: status\.multiplier, payout, balance: Number\(user\?\.balance \|\| 0\) \}/);
assert.match(game, /balance:Number\(user\?\.balance \|\| 0\)/);
assert.doesNotMatch(game, /db\.update\(users\)\.set\(\{\s*balance/);
assert.match(economy, /CREATE TRIGGER IF NOT EXISTS bika_transactions_after_insert/);
assert.match(economy, /idempotencyKeys/);
assert.match(economy, /required_balance/);
assert.match(mini, /case 'walletTransfer':[\s\S]*transferByWalletId/);
assert.match(schema, /table\('two_d_events'/);
assert.match(schema, /table\('sports_bets'/);
assert.match(schema, /table\('shop_cards'/);
assert.match(schema, /table\('auctions'/);
assert.ok(message.includes('successful_payment'), 'successful payment handler must be wired');
assert.ok(message.includes("command.name === 'stars'"), 'Stars invoice command must be wired');
assert.ok(message.includes("callback_data: 'stars:buy:'"), 'Stars package buttons must be wired');
assert.ok(callbacks.includes("game === 'mines'"), 'Mines callbacks must be wired');
assert.ok(stars.includes('creditExternalPurchase'), 'paid Stars balance must use external-credit ledger');
assert.ok(stars.includes('telegram_payment_charge_id'), 'payment charge ID must be checked');
assert.ok(preCheckout.includes('validatePreCheckout'), 'pre-checkout validation must be wired');
console.log('Serverless V2 syntax/import/contract checks passed (' + files.length + ' backend modules).');
