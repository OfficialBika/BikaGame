import { api, EndpointError } from 'sdk';

const ATOMIC_SETTLEMENT_DISABLED = new EndpointError(
  'Game actions are disabled until atomic balance and ledger settlement is verified.',
  { code: 'ATOMIC_SETTLEMENT_UNAVAILABLE' },
);

export default async function (query) {
  const data = String(query?.data || '');
  if (!query?.id) return;

  const [game] = data.split(':');
  const isGameAction = ['crash', 'mines', 'bj', 'shan'].includes(game);
  const error = isGameAction
    ? ATOMIC_SETTLEMENT_DISABLED
    : new EndpointError('Unsupported callback action.', { code: 'NOT_PORTED' });

  console.error('BIKA_SERVERLESS_CALLBACK_BLOCKED', {
    action: data,
    code: error?.code || 'NOT_PORTED',
  });
  return api.answerCallbackQuery({
    callback_query_id: query.id,
    text: isGameAction
      ? 'Game action disabled until settlement is verified.'
      : 'Unsupported preview action.',
    show_alert: true,
  });
}
