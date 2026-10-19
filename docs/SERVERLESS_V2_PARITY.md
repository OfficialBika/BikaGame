# Serverless V2 — feature parity and production cutover gate

This branch is a staging/preview implementation, not a replacement for the MongoDB-backed production bot.
Do not merge/cut over to production until this checklist is green. Presence of a schema/table or endpoint wrapper
is not proof of feature parity.

## Required parity matrix (source of truth: `main`)

| Domain | Required behavior | Current verified state | Release gate |
|---|---|---|---|
| Economy / wallet | Read actual main balance, treasury and wallet IDs; every debit/credit is atomic and auditable | V2 uses isolated serverless database; production import is false | Block production |
| `.slot` | Same syntax, odds/RTP settings, limits, cooldown, result/history and atomic settlement | Telegram command and Mini App preview route are wired; exact main odds/RTP/cooldown parity and end-to-end settlement tests remain | Verify parity + test |
| `.bj` / Blackjack | Same multiplayer/solo lifecycle, action validation, timeout, settlement, no duplicate payouts | V2 has preview session functions; concurrency/replay and exact-main parity remain unverified | Implement + test |
| `.shan` | Same challenge/accept/cancel/expiry, room lifecycle, house cut, settlement and cleanup | V2 preview has basic create/join/draw/stay; exact main parity is unverified | Implement + test |
| `.dice` | Same challenge, accept/cancel, timer, participant validation, house cut and one-time payout | V2 now has persistent challenge creation, target-only acceptance, 60-second expiry, real Telegram dice, atomic two-player settlement, separate tie refunds and an idempotency key; isolated settlement-plan and real SQLite trigger tests are added, but CI execution, SDK/runtime and Telegram smoke tests remain | Run runtime + parity tests |
| `.mine` / `.mines` | Alias parity, board rules, first-pick protection, cashout, timeout, active-session uniqueness, one-time payout | V2 Mines preview exists; alias parity and concurrency/replay tests remain | Implement + test |
| Per-game `/on` and `/off` | Owner-only enable/disable controls for each named game; persisted config; enforced across commands, callbacks and Mini App APIs | V2 persists owner-only per-game settings and enforces new starts on the ported command/API paths; owner-ID configuration and complete entry-point coverage must be verified in the isolated test bot | Verify all entry points + test |
| Auction | Create/post/edit bids, validation, increment, bid funds, expiry/finalization, refund/settle atomically, restart-safe scheduling | Target schema exists; service/state transitions are not ported to V2 | Implement + test |
| 2D | Main schedule/timezone, bets/caps, open/close/result publishing, exact payout/treasury reconciliation and idempotent settlement | Target tables exist; handlers/state transitions are not ported to V2 | Implement + test |
| Broadcast | Owner-only, text and reply-copy preserving media/caption/buttons, approved groups only, bounded rate/concurrency, retry/429 handling, progress/cancel, persistent lock/heartbeat | V2 now has persistent job/target snapshots, text/copy, approved-group filtering, 25/sec pacing, concurrency 8, retry/backoff, progress/cancel/resume and a durable lock. Each invocation handles at most 100 recipients; large jobs need explicit `/broadcast resume`, unlike main's running worker. Runtime, restart/race and Telegram 429 smoke tests remain | Finish automatic continuation strategy + runtime test |
| Group approval | Track groups, require bot admin, owner approve/reject/status and send only to approved groups | V2 records group state, verifies bot admin via Telegram API before approval, records owner action metadata and gates group commands/callbacks; runtime smoke test and broadcast integration remain | Runtime + broadcast integration test |
| Stars | Package selection, invoice, pre-checkout, verified payment, unique charge id, duplicate callback protection, refunds/reconciliation | Purchase path is wired; real payment/refund tests remain | Test before cutover |
| Other main domains | Promo/global RTP settings, daily rewards, shop/inventory/sell, tournaments, sports, admin/treasury, background jobs, group lifecycle, wallet transfers | Schema/partial endpoints only; main parity not achieved | Inventory + port + test |
| Retention | Delete ephemeral histories/completed sessions according to policy; never delete balances, durable inventory, active wagers or replay guards | Three-day cleanup exists; needs tests against every table and replay scenarios | Test before cutover |
| Data import | Migrate production user IDs/wallets/balances/config/treasury/groups/active and pending operations with reconciliation report | No production snapshot imported | Block production |

## Per-game switch contract

The Telegram Serverless V8 runtime does not provide normal Node.js `process.env`; configure the numeric owner ID in `tgcloud/lib/config.js` as `SERVERLESS_OWNER_TELEGRAM_ID`. Its default is `0`, which intentionally fails closed. Do not deploy owner controls until the value is configured and verified. Dice starts also check the persisted Dice switch; an already accepted challenge may finish settling if the owner turns Dice off.

The requested game controls are distinct from global maintenance:
- `/slot on|off`, `/bj on|off`, `/shan on|off`, `/dice on|off`, and `/mine on|off` (also recognize `mines`).
- Only the configured owner can change state.
- Persist the state in the authoritative settings store. Default behavior must be explicitly defined and tested.
- Check state on every entry point (group command, Mini App endpoint, callback/action, scheduled settlement when relevant), not just the command parser.
- Turning a game off blocks new rounds and new joins; it must not strand or erase funded active sessions. Document whether already-started sessions can finish and test that policy.
- Respond with current state and audit actor/time; invalid game names or values must not mutate settings.
- Add tests for unauthorized toggles, aliases, persistence across restart, API bypass attempts, active-session behavior, and concurrent requests.

## Required tests and cutover gate

1. Use fixtures derived from main contracts; never use a production database for tests.
2. Test every registered command/alias and callback path against main behavior.
3. For all balance-changing paths, test insufficient balance, concurrent identical requests, retries after ambiguous timeouts, duplicate callbacks/webhooks, house/treasury caps, and exactly-once history.
4. Test Auction/2D scheduled transitions using a fake clock and process restart.
5. Test broadcast copy/text, approved-group filtering, 429/retry-after, permanent recipient failures, cancellation, stale lock recovery, and progress counters.
6. Test retention at cutoff boundaries, while proving balances/settings/inventory/active operations/idempotency markers remain safe.
7. Reconcile source/target user counts, wallet IDs, every balance, treasury, outstanding wagers, pending payments and inventory after a dry-run import.
8. Exercise rollback and ensure exactly one writer handles money at every stage.
9. Require CI to run syntax, contract, unit and integration tests; static grep/regex checks alone are insufficient.

**Production status: BLOCKED** until the required matrix is implemented, tests pass, import/reconciliation is signed off, and rollback is proven.
