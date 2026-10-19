export function paymentRecordMatches(record, expected) {
  if (!record || !expected) return false;
  const sameCharge = String(record.id ?? '') === String(expected.chargeId ?? '') &&
    String(record.telegramPaymentChargeId ?? '') === String(expected.chargeId ?? '') &&
    String(record.userId ?? '') === String(expected.userId ?? '');
  if (!sameCharge) return false;

  // After three days, cleanup intentionally scrubs payment details but retains
  // the charge/user pair as a compact replay guard. Never re-credit that charge.
  if (String(record.status ?? '') === 'dedupe_only') return true;

  return Number(record.stars) === Number(expected.stars) &&
    Number(record.amount) === Number(expected.amount) &&
    String(record.status ?? '') === String(expected.status ?? '') &&
    String(record.invoicePayload ?? '') === String(expected.invoicePayload ?? '');
}

export function paymentLedgerMatches(record, expected) {
  if (!record || !expected) return false;
  const meta = record.meta && typeof record.meta === 'object' ? record.meta : {};
  return String(record.type ?? '') === 'stars_bal_purchase' &&
    String(record.accountUserId ?? '') === String(expected.userId ?? '') &&
    Number(record.amount) === Number(expected.amount) &&
    String(meta.chargeId ?? '') === String(expected.chargeId ?? '') &&
    String(meta.invoicePayload ?? '') === String(expected.invoicePayload ?? '') &&
    Number(meta.stars) === Number(expected.stars);
}
