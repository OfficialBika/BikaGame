'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const envModule = path.join(__dirname, '..', 'config', 'env.js');
const servicePath = path.join(__dirname, 'twoDService.js');

function loadEnv(overrides = {}) {
  const script = `
    process.env.BOT_TOKEN = 'test-token';
    process.env.MONGO_URI = 'mongodb://127.0.0.1:27017/test';
    process.env.OWNER_ID = '1';
    delete process.env['2D_PAYOUT'];
    delete process.env.TWO_D_PAYOUT;
    Object.assign(process.env, ${JSON.stringify(overrides)});
    const { env } = require(${JSON.stringify(envModule)});
    process.stdout.write(String(env.TWO_D_PAYOUT));
  `;
  const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  return result;
}

test('2D_PAYOUT defaults to 85 without requiring an env entry', () => {
  const result = loadEnv();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '85');
});

test('2D_PAYOUT environment value overrides the default', () => {
  const result = loadEnv({ '2D_PAYOUT': '92.5' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '92.5');
});

test('TWO_D_PAYOUT remains a supported compatibility alias', () => {
  const result = loadEnv({ TWO_D_PAYOUT: '88' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '88');
});

test('2D_PAYOUT takes precedence over the compatibility alias', () => {
  const result = loadEnv({ '2D_PAYOUT': '85', TWO_D_PAYOUT: '40' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '85');
});

test('invalid 2D_PAYOUT fails fast during config loading', () => {
  const result = loadEnv({ '2D_PAYOUT': '0' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid 2D_PAYOUT/);
});

test('2D settlement calculations use the configured payout constant consistently', () => {
  const source = require('node:fs').readFileSync(servicePath, 'utf8');
  assert.match(source, /const PAYOUT = env\.TWO_D_PAYOUT;/);
  assert.doesNotMatch(source, /const PAYOUT = 40;/);
  assert.match(source, /Number\(x\.totalAmount\) \* PAYOUT/);
  assert.match(source, /Number\(x\.totalAmount\) \* PAYOUT/);
});
