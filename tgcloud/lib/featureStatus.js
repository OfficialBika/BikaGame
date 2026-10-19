const groups = [
  {
    id: 'account',
    label: 'Account and core economy',
    status: 'foundation-added',
    features: ['/start', '/help', '/balance', '/wallet', '/top10', '/history', 'atomic ledger settlement', 'Mini App wallet transfer with persistent wallet IDs'],
    detail: 'The serverless preview uses its own database. Mini App wallet transfer now uses a single idempotent ledger row and generated wallet IDs; test-bot replay/concurrency smoke tests remain. The /transfer chat command stays disabled. Production data has not been imported.',
  },
  {
    id: 'single-round-games',
    label: 'Single-round Mini App games',
    status: 'preview-only',
    features: ['Slot', 'Plinko', 'Lucky Wheel', 'Daily Wheel'],
    detail: 'Mini App preview routes exist. Telegram command parity, main RTP/admin settings parity, and end-to-end settlement tests are not complete.',
  },
  {
    id: 'session-games',
    label: 'Session and multiplayer games',
    status: 'in-progress',
    features: ['Crash', 'Mines', 'Blackjack', 'Shan Koe Mee', 'Dice Duel'],
    detail: 'Preview implementations exist; exact main parity, durable lifecycle, concurrent-session, timeout/retry and payout-replay tests are not complete. Dice Duel has a persistent challenge flow and atomic idempotent settlement plan; isolated settlement-plan and real SQLite ledger-trigger tests now pass in CI, while Telegram runtime tests remain.',
  },
  {
    id: 'game-controls',
    label: 'Per-game controls',
    status: 'preview-controls-added',
    features: ['.slot on/off', '.bj on/off', '.shan on/off', '.dice on/off', '.mine on/off', '.mines alias'],
    detail: 'Owner-only persisted controls are implemented in the V2 preview handler and enforce new game starts/entries through the bot handler and Mini App start routes. Set SERVERLESS_OWNER_TELEGRAM_ID in tgcloud/lib/config.js to the numeric production OWNER_ID before deploying; zero keeps writes disabled. Dice Duel is implemented in the preview handler with challenge/accept/cancel and atomic settlement; active-session callbacks remain available so disabling a game does not block settlement of an accepted challenge.',
  },
  {
    id: 'payments-commerce',
    label: 'Payments and commerce',
    status: 'partial',
    features: ['Telegram Stars invoices', 'Pre-checkout validation', 'Successful-payment charge-ID idempotency', 'Refunds', 'Card shop/inventory/sell', 'Orders', 'Payment reconciliation'],
    detail: 'Stars purchase path is wired but needs real Telegram payment tests. Refund, commerce, and reconciliation flows are not fully ported.',
  },
  {
    id: 'two-d-auction',
    label: '2D and Auction',
    status: 'schema-only',
    features: ['2D betting schedule and settlement', 'Auction creation and bids', 'Auction expiry/finalization/refunds'],
    detail: 'Target tables exist, but main behavior, money-hold/state transitions, scheduled jobs, and exactly-once settlement are not ported and tested.',
  },
  {
    id: 'group-approval',
    label: 'Group approval',
    status: 'preview-implemented-needs-runtime-test',
    features: ['/approve', '/reject', '/groupstatus', 'Bot Admin verification', 'Owner-only decision', 'Group command and callback gate'],
    detail: 'V2 now records groups in its isolated database, verifies the bot administrator status through the Telegram Bot API before approval, records owner action metadata, and gates group commands/callbacks for unapproved groups. Runtime smoke tests and approved-group broadcast integration remain outstanding.',
  },
  {
    id: 'broadcast',
    label: 'Broadcast',
    status: 'partial-resumable-batch-needs-runtime-test',
    features: ['Owner-only text/copy', 'Approved groups only', '25 sends/sec rate cap', 'Bounded concurrency and retry-after', 'Persistent target snapshot and lock', 'Progress/cancel/resume'],
    detail: 'V2 now stores a durable job and target snapshot, supports text and copyMessage mode, filters groups to approved rows, caps each invocation to 100 targets, and provides status/cancel/resume controls with retry/backoff. Unlike the always-running production service, bigger broadcasts require explicit /broadcast resume per batch; Telegram runtime tests, cross-invocation lock behavior, and full main parity remain unverified.',
  },
  {
    id: 'other-main-features',
    label: 'Remaining main features',
    status: 'schema-foundation',
    features: ['Sports betting/events', 'Tournaments', 'Promo RTP', 'Admin/owner controls', 'Shop/inventory/sell', 'Scheduled/background jobs', 'Production data import'],
    detail: 'Schema or partial route presence is not feature parity. Mini App wallet transfer has a single-row atomic ledger implementation; Auctions, 2D, sports betting, full shop/inventory/sell, tournament parity, background scheduling, handlers, configuration, migrations, import, and behavioral tests remain required.',
  },
];
export function getFeatureStatus() {
  return {
    ok: true,
    environment: 'serverless-v2-staging',
    productionDataImported: false,
    productionCutoverApproved: false,
    liveEconomyEnabled: false,
    status: 'BLOCKED',
    groups,
  };
}
