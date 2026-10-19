import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../tgcloud/lib/groupApprovalPolicy.js', import.meta.url), 'utf8');
const policy = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

assert.equal(policy.isGroupChat({ type: 'group' }), true);
assert.equal(policy.isGroupChat({ type: 'supergroup' }), true);
assert.equal(policy.isGroupChat({ type: 'private' }), false);
assert.equal(policy.isBotAdministratorStatus('administrator'), true);
assert.equal(policy.isBotAdministratorStatus('creator'), true);
assert.equal(policy.isBotAdministratorStatus('member'), false);
assert.equal(policy.isBotAdministratorStatus('unknown'), false);

assert.equal(policy.isConfiguredOwner(9001, 9001), true);
assert.equal(policy.isConfiguredOwner(9001, 0), false);
assert.equal(policy.isConfiguredOwner(0, 9001), false);
assert.equal(policy.isConfiguredOwner('9001', 9001), true);
assert.equal(policy.isFreshBotAdminCheck({ data: { botAdminCheckedAt: new Date(100000).toISOString() } }, 120000, 60000), true);
assert.equal(policy.isFreshBotAdminCheck({ data: { botAdminCheckedAt: new Date(100000).toISOString() } }, 160000, 60000), false);
assert.equal(policy.isFreshBotAdminCheck({ data: { botAdminCheckedAt: 'not-a-date' } }, 120000, 60000), false);

assert.deepEqual(policy.groupAccessDecision({ approvalStatus: 'pending', botIsAdmin: false }, 10, 9001),
  { allowed: false, reason: 'admin_required' });
assert.deepEqual(policy.groupAccessDecision({ approvalStatus: 'pending', botIsAdmin: true }, 10, 9001),
  { allowed: false, reason: 'pending' });
assert.deepEqual(policy.groupAccessDecision({ approvalStatus: 'rejected', botIsAdmin: true }, 10, 9001),
  { allowed: false, reason: 'rejected' });
assert.deepEqual(policy.groupAccessDecision({ approvalStatus: 'approved', botIsAdmin: false }, 10, 9001),
  { allowed: false, reason: 'admin_required' });
assert.deepEqual(policy.groupAccessDecision({ approvalStatus: 'pending', botIsAdmin: false }, 9001, 9001),
  { allowed: true, reason: 'owner' });
assert.deepEqual(policy.groupAccessDecision({ approvalStatus: 'approved', botIsAdmin: true }, 9001, 0),
  { allowed: true, reason: 'approved' });
assert.deepEqual(policy.groupAccessDecision({ approvalStatus: 'pending', botIsAdmin: true }, 9001, 0),
  { allowed: false, reason: 'pending' });

const service = await readFile(new URL('../tgcloud/lib/groupApproval.js', import.meta.url), 'utf8');
const message = await readFile(new URL('../tgcloud/handlers/message.js', import.meta.url), 'utf8');
const callbacks = await readFile(new URL('../tgcloud/handlers/callback_query.js', import.meta.url), 'utf8');
assert.match(service, /api\.getMe\(\)/);
assert.match(service, /api\.getChatMember\(/);
assert.match(service, /isFreshBotAdminCheck\(group\)/);
assert.match(service, /reason: 'admin_unverified'/);
assert.match(service, /approvalStatus: 'pending'/);
assert.match(service, /code: 'BOT_ADMIN_REQUIRED'/);
assert.match(service, /SERVERLESS_OWNER_TELEGRAM_ID/);
assert.match(message, /approveCurrentGroup/);
assert.match(message, /rejectCurrentGroup/);
assert.match(message, /checkGroupAccess/);
assert.match(callbacks, /checkGroupAccess/);
assert.match(callbacks, /answerCallbackQuery/);
console.log('Group approval policy tests passed (statuses, owner fail-closed, and handler wiring).');
