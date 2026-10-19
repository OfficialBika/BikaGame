const groups = [
  {
    id: 'account',
    label: 'Account and read-only data',
    status: 'preview',
    features: ['/start', '/help', '/balance', '/wallet', '/top10', '/history', '/features', '/play'],
    detail: 'Profile and preview history use the Serverless SQLite database; no production MongoDB data is imported.',
  },
  {
    id: 'miniapp-games',
    label: 'Mini App games',
    status: 'preview-only',
    features: ['Slot', 'Plinko', 'Lucky Wheel', 'Daily Wheel', 'Crash', 'Mines', 'Blackjack', 'Shan Koe Mee'],
    detail: 'Endpoints are connected to isolated preview logic. They are not production game/economy parity and must not be used for live balances.',
  },
  {
    id: 'wallet-payments',
    label: 'Wallet transfers and payments',
    status: 'disabled',
    features: ['Wallet transfer', 'Gift', 'Telegram Stars purchase/refund', 'Payment reconciliation'],
    detail: 'Money-moving operations stay disabled until atomic settlement, idempotency, receipts and replay/reconciliation tests are implemented.',
  },
  {
    id: 'production-systems',
    label: 'Production systems not yet ported',
    status: 'not-ported',
    features: ['2D betting', 'Sports betting/events', 'Card shop/inventory/sell', 'Auctions', 'Tournaments', 'Promo RTP', 'Admin/owner controls', 'Broadcast/group approval', 'Scheduled/background jobs', 'MongoDB data import'],
    detail: 'These features require dedicated migrations; no placeholder success responses are returned.',
  },
];

export function getFeatureStatus() {
  return {
    ok: true,
    environment: 'serverless-preview',
    productionDataImported: false,
    productionCutoverApproved: false,
    groups,
  };
}
