import assert from 'node:assert/strict';
import { isWalletId, userIdFromWalletId, walletIdForUserId, walletSuffix } from '../tgcloud/lib/walletPolicy.js';

assert.equal(walletIdForUserId(123456789, 'abcde'), 'Bika123456789abcde');
assert.equal(walletIdForUserId('123', 'zzzzz'), 'Bika123zzzzz');
assert.equal(walletIdForUserId(0, 'abcde'), null);
assert.equal(walletIdForUserId(-1, 'abcde'), null);
assert.equal(walletIdForUserId('1e3', 'abcde'), null);
assert.equal(walletIdForUserId(Number.MAX_SAFE_INTEGER + 1, 'abcde'), null);
assert.equal(walletIdForUserId(123, 'ab12e'), null);
assert.equal(userIdFromWalletId('Bika123456789abcde'), '123456789');
assert.equal(userIdFromWalletId('bika123ABCDE'), '123');
assert.equal(userIdFromWalletId('123456789'), null);
assert.equal(userIdFromWalletId('Bika0abcde'), null);
assert.equal(userIdFromWalletId('Bika1234abc'), null);
assert.equal(isWalletId('Bika99zzzzz'), true);
assert.equal(isWalletId('Bika99zzz99'), false);
assert.equal(walletSuffix(() => 0), 'aaaaa');
assert.equal(walletSuffix(() => 0.999999), 'zzzzz');
assert.equal(walletSuffix(() => Number.NaN), 'aaaaa');

console.log('Wallet ID policy tests passed (format, validation, legacy rejection, suffix generation).');
