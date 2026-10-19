import { api, EndpointError, db } from 'sdk';
import { eq } from 'sdk/db';
import { paymentEvents, users } from '../schema.js';
import { ensureEconomy, ensureUser, creditExternalPurchase, getTransaction } from './economy.js';
import { paymentLedgerMatches, paymentRecordMatches } from './starsPolicy.js';

export const STAR_TO_BAL = 45000;
export const STAR_PACKAGES = Object.freeze([10, 20, 30, 40, 50, 100]);

export function packageBalance(stars) {
  return Number(stars) * STAR_TO_BAL;
}

function validStars(value) {
  const stars = Number(value);
  if (!Number.isSafeInteger(stars) || !STAR_PACKAGES.includes(stars)) {
    throw new EndpointError('Stars package မမှန်ပါ။', { code: 'INVALID_STARS_PACKAGE', packages: STAR_PACKAGES });
  }
  return stars;
}

export function invoicePayload(stars, userId) {
  return JSON.stringify({ v: 1, kind: 'bal_purchase', stars: validStars(stars), userId: String(userId) });
}

export function parseInvoicePayload(payload) {
  try {
    const data = JSON.parse(String(payload || ''));
    if (data?.v !== 1 || data?.kind !== 'bal_purchase' || !data?.userId) return null;
    return { stars: validStars(data.stars), userId: String(data.userId) };
  } catch (_) {
    return null;
  }
}

export async function createStarsInvoice(userId, stars) {
  await ensureEconomy();
  const user = await ensureUser({ id: Number(userId) });
  const count = validStars(stars);
  const payload = invoicePayload(count, user.tgId);
  await api.sendInvoice({
    chat_id: Number(user.tgId),
    title: `BIKA Balance — ${count} Stars`,
    description: `${packageBalance(count).toLocaleString()} BIKA balance`,
    payload,
    currency: 'XTR',
    provider_token: '',
    prices: [{ label: `${count} Telegram Stars`, amount: count }],
  });
  return { ok: true, stars: count, balanceAmount: packageBalance(count), payload };
}

export async function validatePreCheckout(query) {
  const parsed = parseInvoicePayload(query?.invoice_payload);
  if (!parsed) return { ok: false, error: 'Invalid invoice.' };
  if (String(query?.currency || '') !== 'XTR' || Number(query?.total_amount) !== parsed.stars) {
    return { ok: false, error: 'Payment amount is invalid.' };
  }
  if (String(query?.from?.id) !== parsed.userId) return { ok: false, error: 'Payment user is invalid.' };
  return { ok: true, ...parsed };
}

export async function creditSuccessfulStars(message) {
  await ensureEconomy();
  const payment = message?.successful_payment;
  if (!payment) throw new EndpointError('Successful payment data မရှိပါ။', { code: 'PAYMENT_REQUIRED' });
  const parsed = parseInvoicePayload(payment.invoice_payload);
  if (!parsed) throw new EndpointError('Invoice payload မမှန်ပါ။', { code: 'INVALID_PAYMENT_PAYLOAD' });
  if (String(payment.currency || '') !== 'XTR' || Number(payment.total_amount) !== parsed.stars) {
    throw new EndpointError('Payment amount မမှန်ပါ။', { code: 'INVALID_PAYMENT_AMOUNT' });
  }
  const userId = Number(message?.from?.id);
  if (String(userId) !== parsed.userId) throw new EndpointError('Payment user မကိုက်ညီပါ။', { code: 'PAYMENT_USER_MISMATCH' });
  const chargeId = String(payment.telegram_payment_charge_id || '').trim();
  if (!chargeId) throw new EndpointError('Telegram charge ID မရှိပါ။', { code: 'PAYMENT_CHARGE_REQUIRED' });

  const expectedRecord = {
    chargeId,
    userId: String(userId),
    stars: parsed.stars,
    amount: packageBalance(parsed.stars),
    status: 'completed',
    invoicePayload: String(payment.invoice_payload),
  };
  const existing = await dbPayment(chargeId);
  if (existing) {
    if (!paymentRecordMatches(existing, expectedRecord)) {
      throw new EndpointError('Charge ID နှင့် payment record မကိုက်ညီပါ။', { code: 'PAYMENT_CHARGE_MISMATCH' });
    }
    const user = await db.select().from(users).where(eq(users.tgId, userId)).get();
    return { ok: true, duplicate: true, stars: parsed.stars, balanceAmount: packageBalance(parsed.stars), balance: Number(user?.balance || 0) };
  }

  const result = await creditExternalPurchase({
    idempotencyKey: '__stars_purchase:' + chargeId,
    userId,
    amount: packageBalance(parsed.stars),
    type: 'stars_bal_purchase',
    source: 'TELEGRAM_STARS',
    meta: {
      stars: parsed.stars,
      exchangeRate: STAR_TO_BAL,
      telegramPaymentChargeId: chargeId,
      chargeId,
      invoicePayload: payment.invoice_payload,
      providerPaymentChargeId: payment.provider_payment_charge_id || null,
    },
  });

  // If the ledger operation already exists (including a retry after a crash),
  // bind the charge to the original transaction before writing reconciliation data.
  if (result.duplicate) {
    const ledger = await getTransaction('__stars_purchase:' + chargeId);
    if (!paymentLedgerMatches(ledger, expectedRecord)) {
      throw new EndpointError('Charge ID နှင့် မူလ ledger transaction မကိုက်ညီပါ။', { code: 'PAYMENT_CHARGE_MISMATCH' });
    }
  }

  // The ledger insert is the authoritative balance mutation. Persist a separate
  // payment event for reconciliation after it succeeds; a retry after a crash
  // is safe because creditExternalPurchase is idempotent by Telegram charge ID.
  const timestamp = new Date();
  await db.insert(paymentEvents).values({
    id: chargeId,
    userId,
    stars: parsed.stars,
    amount: packageBalance(parsed.stars),
    status: 'completed',
    payload: {
      source: 'TELEGRAM_STARS',
      exchangeRate: STAR_TO_BAL,
      providerPaymentChargeId: payment.provider_payment_charge_id || null,
    },
    telegramPaymentChargeId: chargeId,
    invoicePayload: String(payment.invoice_payload),
    createdAt: timestamp,
    updatedAt: timestamp,
  }).onConflictDoNothing().run();

  const saved = await dbPayment(chargeId);
  if (!paymentRecordMatches(saved, expectedRecord)) {
    throw new EndpointError('Payment ledger မှတ်တမ်းကို အတည်ပြုမရပါ။', { code: 'PAYMENT_RECORD_FAILED' });
  }
  return { ok: true, duplicate: result.duplicate, stars: parsed.stars, balanceAmount: packageBalance(parsed.stars), balance: result.balance };
}

async function dbPayment(chargeId) {
  return db.select().from(paymentEvents).where(eq(paymentEvents.id, chargeId)).get();
}
