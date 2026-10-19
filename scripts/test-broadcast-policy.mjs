import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../tgcloud/lib/broadcastPolicy.js', import.meta.url), 'utf8');
const policy = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

assert.equal(policy.escapeHtml('<tag>&"\'x\''), '&lt;tag&gt;&amp;&quot;&#39;x&#39;');
assert.deepEqual(policy.parseBroadcastRequest('hello world', false), {
  action: 'start', mode: 'text', text: 'hello world',
});
assert.deepEqual(policy.parseBroadcastRequest('', true), {
  action: 'start', mode: 'copy', text: '',
});
assert.deepEqual(policy.parseBroadcastRequest('-copy', true), {
  action: 'start', mode: 'copy', text: '',
});
assert.deepEqual(policy.parseBroadcastRequest('-copy', false), { action: 'invalid-copy' });
assert.deepEqual(policy.parseBroadcastRequest('-copy -h', true), { action: 'help' });
assert.deepEqual(policy.parseBroadcastRequest('--help', false), { action: 'help' });
assert.deepEqual(policy.parseBroadcastRequest('resume', false), { action: 'resume' });
assert.deepEqual(policy.parseBroadcastRequest('status', false), { action: 'status' });
assert.deepEqual(policy.parseBroadcastRequest('cancel', false), { action: 'cancel' });
assert.deepEqual(policy.parseBroadcastRequest('', false), { action: 'help' });

assert.equal(policy.isPermanentRecipientError({ description: 'Forbidden: bot was blocked by the user' }), true);
assert.equal(policy.isPermanentRecipientError({ description: 'Too Many Requests' }), false);
assert.equal(policy.broadcastRetryDelayMs({ code: 429, parameters: { retry_after: 2 } }, 1), 2250);
assert.equal(policy.broadcastRetryDelayMs({ code: 500 }, 2), 500);
assert.equal(policy.broadcastRetryDelayMs({ code: 400, description: 'Bad Request' }, 2), 0);

const service = await readFile(new URL('../tgcloud/lib/broadcast.js', import.meta.url), 'utf8');
const schema = await readFile(new URL('../tgcloud/schema.js', import.meta.url), 'utf8');
const message = await readFile(new URL('../tgcloud/handlers/message.js', import.meta.url), 'utf8');
const callbacks = await readFile(new URL('../tgcloud/handlers/callback_query.js', import.meta.url), 'utf8');
assert.match(service, /BATCH_SIZE = 100/);
assert.match(service, /SENDS_PER_SECOND = 25/);
assert.match(service, /SEND_CONCURRENCY = 8/);
assert.match(service, /broadcast_locks|broadcastLocks/);
assert.match(service, /approvalStatus/);
assert.match(service, /copyMessage/);
assert.match(source, /retry_after/);
assert.match(service, /status: 'paused'/);
assert.match(service, /cancel_requested/);
assert.match(schema, /table\('broadcast_targets'/);
assert.match(schema, /table\('broadcast_locks'/);
assert.match(message, /startBroadcast\(/);
assert.match(message, /resumeBroadcast\(/);
assert.match(message, /cancelBroadcast\(/);
assert.match(message, /parseBroadcastRequest/);
assert.match(callbacks, /game === 'broadcast' && action === 'resume'/);
assert.match(callbacks, /resumeBroadcast\(/);
console.log('Broadcast policy and service wiring tests passed (text/copy, retry, rate cap, lock, pause/resume/cancel).');
