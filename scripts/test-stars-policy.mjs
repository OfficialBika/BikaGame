import assert from 'node:assert/strict';
import { paymentRecordMatches } from '../tgcloud/lib/starsPolicy.js';

const expected = {
  chargeId: 'charge-123',
  userId: '10001',
  stars: 20,
  amount: 900000,
  invoicePayload: '{"v":1,"kind":"bal_purchase","stars":20,"userId":"10001"}',
};
const record = {
  id: expected.chargeId,
  telegramPaymentChargeId: expected.chargeId,
  userId: 10001,
  stars: 20,
  amount: 900000,
  invoicePayload: expected.invoicePayload,
};
assert.equal(paymentRecordMatches(record, expected), true);
assert.equal(paymentRecordMatches(null, expected), false);
assert.equal(paymentRecordMatches({ ...record, userId: 10002 }, expected), false);
assert.equal(paymentRecordMatches({ ...record, stars: 10 }, expected), false);
assert.equal(paymentRecordMatches({ ...record, amount: 450000 }, expected), false);
assert.equal(paymentRecordMatches({ ...record, telegramPaymentChargeId: 'other' }, expected), false);
assert.equal(paymentRecordMatches({ ...record, invoicePayload: 'tampered' }, expected), false);
assert.equal(paymentRecordMatches({ ...record, id: 'other' }, expected), false);
console.log('Stars payment reconciliation record tests passed.');
