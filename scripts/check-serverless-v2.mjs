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
const groupApproval = await readFile(join(root, 'tgcloud/lib/groupApproval.js'), 'utf8');
const groupApprovalPolicy = await readFile(join(root, 'tgcloud/lib/groupApprovalPolicy.js'), 'utf8');
const broadcast = await readFile(join(root, 'tgcloud/lib/broadcast.js'), 'utf8');
const broadcastPolicy = await readFile(join(root, 'tgcloud/lib/broadcastPolicy.js'), 'utf8');
const walletPolicy = await readFile(join(root, 'tgcloud/lib/walletPolicy.js'), 'utf8');
const usersModule = await readFile(join(root, 'tgcloud/lib/users.js'), 'utf8');
const twoDPolicy = await readFile(join(root, 'tgcloud/lib/twoDPolicy.js'), 'utf8');

const starsPolicy = await readFile(join(root, 'tgcloud/lib/starsPolicy.js'), 'utf8');
const dailyPolicy = await readFile(join(root, 'tgcloud/lib/dailyPolicy.js'), 'utf8');
const twoDService = await readFile(join(root, 'tgcloud/lib/twoD.js'), 'utf8');

// V2 must keep production cutover explicitly blocked until main parity and import are proven.
assert.match(parity, /Production status: BLOCKED/);
for (const gameName of ['slot', 'bj', 'shan', 'dice', 'mine']) assert.ok(parity.includes('`/' + gameName + ' on|off`'), 'missing switch contract for ' + gameName);
for (const phrase of ['Auction', '2D', 'Broadcast', 'Group approval', 'Data import', 'rollback']) assert.ok(parity.toLowerCase().includes(phrase.toLowerCase()), 'missing parity gate: ' + phrase);

// Feature metadata must accurately mark unfinished domains and the non-production environment.
assert.match(featureStatus, /productionDataImported: false/);
assert.match(featureStatus, /productionCutoverApproved: false/);
assert.match(featureStatus, /status: 'BLOCKED'/);
for (const status of ['schema-only', 'preview-only']) assert.ok(featureStatus.includes(status), 'missing explicit incomplete status: ' + status);
assert.match(featureStatus, /partial-resumable-batch-needs-runtime-test/);
assert.match(featureStatus, /\.dice on\/off/);
assert.match(featureStatus, /Owner-only text\/copy/);
assert.match(featureStatus, /partial-resumable-batch-needs-runtime-test/);
assert.match(featureStatus, /id: 'two-d'[\s\S]*One-ledger-row atomic bet debit[\s\S]*inbound Telegram updates/);
assert.match(featureStatus, /id: 'auction'[\s\S]*status: 'schema-only'/);

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
assert.ok(callbacks.includes('api.sendDice'), 'Dice must use real Telegram dice values');
assert.match(callbacks, /settleDiceChallenge/, 'Dice callback must use resumable settlement');
assert.match(diceDuel, /CHALLENGE_TIMEOUT_MS = 60000/);
assert.match(diceDuel, /status = 'rolling'/);
assert.match(economy, /buildDuelSettlementRow/);
assert.match(economy, /REFUND_USER_NOT_FOUND/);
assert.ok(economy.includes('json_each(NEW.refunds)'), 'atomic refund trigger must be installed');
assert.ok(economy.includes('bika_transactions_refunds_before_insert'), 'refund validation must use additive triggers');
assert.ok(economy.includes('bika_transactions_refunds_after_insert'), 'refund balance credits must use additive triggers');
assert.doesNotMatch(economy, /DROP TRIGGER IF EXISTS bika_transactions_(before|after)_insert/, 'startup must not drop live balance triggers');
assert.ok(callbacks.includes('Number(user.id) !== Number(session.state?.targetUserId)'), 'Dice retry settlement must remain target-only');
assert.ok(callbacks.includes("await assertGameEnabled('dice')"), 'pending Dice challenges must obey game disable state');
assert.match(duelPlan, /__settlement:/);
assert.match(duelPlan, /fromAccountUserId: target/);
assert.equal((message.match(/\\n(?:Stars|Added|Balance|Rate):/g) || []).length, 0, 'messages must not print escaped literal \\n sequences');

// Group approval must fail closed, verify bot admin status, and gate callback entry points.
assert.match(groupApproval, /api\.getChatMember\(/);
assert.match(groupApproval, /approveCurrentGroup/);
assert.match(groupApproval, /code: 'BOT_ADMIN_REQUIRED'/);
assert.match(groupApprovalPolicy, /function groupAccessDecision/);
assert.match(groupApprovalPolicy, /isFreshBotAdminCheck/);
assert.match(groupApproval, /reason: 'admin_unverified'/);
assert.match(message, /checkGroupAccess/);
assert.match(message, /command\.name === 'approve'/);
assert.match(message, /command\.name === 'reject'/);
assert.match(message, /'approve', 'reject', 'groupstatus'/);
assert.match(callbacks, /checkGroupAccess/);

// Broadcast must be bounded, resumable, persistent, owner-only and filter to approved groups.
assert.match(broadcast, /BATCH_SIZE = 100/);
assert.match(broadcast, /SENDS_PER_SECOND = 25/);
assert.match(broadcast, /SEND_CONCURRENCY = 8/);
assert.match(broadcast, /assertBroadcastOwner/);
assert.match(broadcast, /eq\(groups\.approvalStatus, 'approved'\)/);
assert.match(broadcast, /api\.copyMessage/);
assert.match(broadcast, /broadcastRetryDelayMs/);
assert.match(broadcast, /broadcastLocks/);
assert.match(broadcast, /status: 'paused'/);
assert.match(broadcast, /cancel_requested/);
assert.match(broadcastPolicy, /parseBroadcastRequest/);
assert.match(schema, /table\('broadcast_targets'/);
assert.match(schema, /table\('broadcast_locks'/);
assert.match(message, /startBroadcast\(/);
assert.match(message, /resumeBroadcast\(/);
assert.match(message, /cancelBroadcast\(/);
assert.match(callbacks, /resumeBroadcast\(/);
assert.match(economy, /DELETE FROM broadcast_targets/);
assert.match(economy, /DELETE FROM broadcast_jobs/);

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
assert.match(walletPolicy, /walletIdForUserId/);
assert.match(walletPolicy, /userIdFromWalletId/);
assert.match(walletPolicy, /walletSuffix/);
assert.match(usersModule, /WALLET_ID_ASSIGNMENT_FAILED/);
assert.match(usersModule, /isNull\(users\.walletId\)/);
assert.match(economy, /CASE WHEN NEW\.type = 'gift' THEN 0 ELSE NEW\.amount END/);
assert.match(economy, /fromAccountUserId: from, toAccountUserId: to/);
assert.match(schema, /table\('two_d_events'/);
assert.match(twoDPolicy, /parseTwoDBet/);
assert.match(twoDPolicy, /MAX_PER_NUMBER = 200000/);
assert.match(twoDPolicy, /PAYOUT_MULTIPLIER = 40/);
assert.match(twoDPolicy, /timeZone: 'Asia\/Yangon'/);
assert.match(stars, /db\.insert\(paymentEvents\)/);
assert.match(stars, /PAYMENT_RECORD_FAILED/);
assert.match(stars, /PAYMENT_CHARGE_MISMATCH/);
assert.match(starsPolicy, /paymentRecordMatches/);
assert.match(starsPolicy, /paymentLedgerMatches/);
assert.match(dailyPolicy, /yangonDayBounds/);
assert.match(dailyPolicy, /dailyRewardAmount/);
assert.match(economy, /export async function claimDailyReward/);
assert.match(economy, /DAILY_ALREADY_CLAIMED/);
assert.match(economy, /daily_claimed_at = NEW\.created_at/);
assert.match(economy, /bika_transactions_daily_claim_before_insert/);
assert.match(economy, /bika_transactions_daily_claim_after_insert/);
assert.match(message, /claimDailyReward\(user\.tgId\)/);
assert.match(message, /user\.walletId \|\| 'pending'/);
assert.doesNotMatch(message, /Wallet ID: ' \+ user\.tgId/);
assert.match(message, /isGroupChat\(message\.chat\)/);
assert.match(stars, /getTransaction\('__stars_purchase:' \+ chargeId\)/);
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
