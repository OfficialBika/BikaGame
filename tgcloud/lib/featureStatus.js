const groups = [
  { id: 'account', label: 'Account and core economy', status: 'foundation-added', features: ['/start', '/help', '/balance', '/wallet', '/top10', '/history', 'atomic ledger settlement', 'wallet transfers'], detail: 'SQLite triggers make one ledger INSERT the atomic commit for user balance, treasury, win/loss totals and game history.' },
  { id: 'single-round-games', label: 'Single-round Mini App games', status: 'core-port-added', features: ['Slot', 'Plinko', 'Lucky Wheel', 'Daily Wheel'], detail: 'Core main slot/RTP logic and idempotent, capped one-row settlements are being ported. Platform end-to-end parity tests are still required.' },
  { id: 'session-games', label: 'Session/multiplayer games', status: 'in-progress', features: ['Crash', 'Mines', 'Blackjack', 'Shan Koe Mee'], detail: 'The existing session engine has not yet passed concurrent-session and payout-replay tests; no production cutover is approved.' },
  { id: 'payments-commerce', label: 'Payments and commerce', status: 'schema-foundation', features: ['Telegram Stars purchase/refund', 'Card shop/inventory/sell', 'Orders', 'Payment reconciliation'], detail: 'Target tables exist, but full payment validation, fulfilment, inventory state transitions and refunds still need porting.' },
  { id: 'other-main-features', label: 'Remaining main features', status: 'schema-foundation', features: ['2D betting', 'Sports betting/events', 'Auctions', 'Tournaments', 'Promo RTP', 'Admin/owner controls', 'Broadcast/group approval', 'Scheduled/background jobs', 'Production data import'], detail: 'Target tables have been added for the main domains; handlers, state transitions, migrations and data import are not yet at main parity.' },
];
export function getFeatureStatus() {
  return { ok: true, environment: 'serverless-v2-staging', productionDataImported: false, productionCutoverApproved: false, liveEconomyEnabled: false, groups };
}
