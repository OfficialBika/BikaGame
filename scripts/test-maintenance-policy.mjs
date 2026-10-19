import assert from 'node:assert/strict';
import { maintenanceEnabledFromValue, maintenanceCommandAction, isConfiguredOwnerId } from '../tgcloud/lib/maintenancePolicy.js';

assert.equal(maintenanceEnabledFromValue(null), false, 'missing setting defaults OFF');
assert.equal(maintenanceEnabledFromValue(false), false, 'explicit false means OFF');
assert.equal(maintenanceEnabledFromValue({ enabled: false }), false, 'persisted OFF record stays OFF');
assert.equal(maintenanceEnabledFromValue(true), true, 'legacy true means ON');
assert.equal(maintenanceEnabledFromValue({ enabled: true }), true, 'persisted ON record means ON');
assert.equal(maintenanceEnabledFromValue({ unexpected: 'corrupt' }), true, 'corrupt non-null state fails closed');
assert.deepEqual(maintenanceCommandAction('off'), { action: 'on', legacy: true }, '/off must enable maintenance for main parity');
assert.deepEqual(maintenanceCommandAction('on'), { action: 'off', legacy: true }, '/on must disable maintenance for main parity');
assert.equal(maintenanceCommandAction('help'), null);
assert.equal(isConfiguredOwnerId(12345, 12345), true);
assert.equal(isConfiguredOwnerId('12345', 12345), true);
assert.equal(isConfiguredOwnerId(12345, 0), false, 'unset owner must fail closed');
assert.equal(isConfiguredOwnerId(12345, 'not-an-id'), false);
console.log('Maintenance policy tests passed (default OFF, explicit OFF, ON, corrupt-state fail-closed, legacy command semantics, owner fail-closed).');
