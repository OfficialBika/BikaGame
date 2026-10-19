import { api } from 'sdk';
import { validatePreCheckout } from '../lib/stars.js';

export default async function (query) {
  if (!query?.id) return;
  const validation = await validatePreCheckout(query);
  if (validation.ok) {
    await api.answerPreCheckoutQuery({ pre_checkout_query_id: String(query.id), ok: true });
    return;
  }
  await api.answerPreCheckoutQuery({
    pre_checkout_query_id: String(query.id),
    ok: false,
    error_message: validation.error || 'Payment cannot be processed.',
  });
}
