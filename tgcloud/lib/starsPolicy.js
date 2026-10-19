export function paymentRecordMatches(record, expected) {
  if (!record || !expected) return false;
  return String(record.id ?? '') === String(expected.chargeId ?? '') &&
    String(record.telegramPaymentChargeId ?? '') === String(expected.chargeId ?? '') &&
    String(record.userId ?? '') === String(expected.userId ?? '') &&
    Number(record.stars) === Number(expected.stars) &&
    Number(record.amount) === Number(expected.amount) &&
    String(record.invoicePayload ?? '') === String(expected.invoicePayload ?? '');
}
