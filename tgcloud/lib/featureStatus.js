const groups = [
  {
    id: 'account',
    label: 'Account and read-only data',
    status: 'preview',
    features: ['/start', '/help', '/balance', '/wallet', '/top10', '/history', '/features', '/play'],
    detail: 'Isolated Serverless profile data only. Production balances and user records have not been imported or reconciled.',
  },
  {
    id: 'miniapp-games',
    label: 'Mini App games',
    status: 'disabled',
    features: ['Slot', 'Plinko', 'Lucky Wheel', 'Daily Wheel', 'Crash', 'Mines', 'Blackjack', 'Shan Koe Mee'],
    detail: 'Balance-changing games are deliberately fail-closed because the current SDK path does not yet provide a verified atomic balance + ledger settlement.',
  },
  {
    id: 'wallet-payments',
    label: 'Wallet transfers and payments',
    status: 'disabled',
    features: ['Wallet transfer', 'Gift', 'Telegram Stars purchase/refund', 'Payment reconciliation'],
    detail: 'Not usable for live funds: atomic settlement, Telegram payment verification, duplicate/replay protection and reconciliation are not yet implemented and tested end-to-end.',
  },
  {
    id: 'production-systems',
    label: 'Production systems not yet ported',
    status: 'not-ported',
    features: ['2D betting', 'Sports betting/events', 'Card shop/inventory/sell', 'Auctions', 'Tournaments', 'Promo RTP', 'Admin/owner controls', 'Broadcast/group approval', 'Scheduled/background jobs', 'MongoDB data import'],
    detail: 'These modules require explicit migration and parity tests. The production database is not connected to this app.',
  },
];

export function getFeatureStatus() {
  return {
    ok: true,
    environment: 'serverless-preview',
    productionDataImported: false,
    productionCutoverApproved: false,
    liveEconomyEnabled: false,
    disabledReason: 'ATOMIC_SETTLEMENT_UNAVAILABLE',
    groups,
  };
}
