import assert from 'node:assert/strict';
import { paymentLedgerMatches, paymentRecordMatches } from '../tgcloud/lib/starsPolicy.js';

const expected = {
  chargeId: 'charge-123',
  userId: '10001',
  stars: 20,
  amount: 900000,
  status: 'completed',
  invoicePayload: '{"v":1,"kind":"bal_purchase","stars":20,"userId":"10001"}',
};
const record = {
  id: expected.chargeId,
  telegramPaymentChargeId: expected.chargeId,
  userId: 10001,
  stars: 20,
  amount: 900000,
  status: 'credited',
  invoicePayload: expected.invoicePayload,
};
assert.equal(paymentRecordMatches(record, expected), true);
assert.equal(paymentRecordMatches(null, expected), false);
assert.equal(paymentRecordMatches({ ...record, userId: 10002 }, expected), false);
assert.equal(paymentRecordMatches({ ...record, stars: 10 }, expected), false);
assert.equal(paymentRecordMatches({ ...record, amount: 450000 }, expected), false);
assert.equal(paymentRecordMatches({ ...record, status: 'pending' }, expected), false);
assert.equal(paymentRecordMatches({ ...record, telegramPaymentChargeId: 'other' }, expected), false);
assert.equal(paymentRecordMatches({ ...record, invoicePayload: 'tampered' }, expected), false);
assert.equal(paymentRecordMatches({ ...record, id: 'other' }, expected), false);
assert.equal(paymentRecordMatches({
  id: expected.chargeId,
  telegramPaymentChargeId: expected.chargeId,
  userId: 10001,
  stars: 0,
  amount: 0,
  status: 'dedupe_only',
  invoicePayload: null,
}, expected), true);
assert.equal(paymentRecordMatches({
  id: expected.chargeId,
  telegramPaymentChargeId: expected.chargeId,
  userId: 10002,
  stars: 0,
  amount: 0,
  status: 'dedupe_only',
  invoicePayload: null,
}, expected), false);
console.log('Stars payment reconciliation record tests passed.');

const ledger = {
  type: 'stars_bal_purchase',
  accountUserId: 10001,
  amount: 900000,
  meta: { chargeId: 'charge-123', invoicePayload: expected.invoicePayload, stars: 20 },
};
assert.equal(paymentLedgerMatches(ledger, expected), true);
assert.equal(paymentLedgerMatches({ ...ledger, accountUserId: 10002 }, expected), false);
assert.equal(paymentLedgerMatches({ ...ledger, amount: 450000 }, expected), false);
assert.equal(paymentLedgerMatches({ ...ledger, type: 'win' }, expected), false);
assert.equal(paymentLedgerMatches({ ...ledger, meta: { ...ledger.meta, chargeId: 'other' } }, expected), false);
assert.equal(paymentLedgerMatches({ ...ledger, meta: { ...ledger.meta, invoicePayload: 'tampered' } }, expected), false);
assert.equal(paymentLedgerMatches({ ...ledger, meta: { ...ledger.meta, stars: 10 } }, expected), false);
