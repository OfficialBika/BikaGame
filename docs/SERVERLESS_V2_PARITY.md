# Serverless V2 — feature parity and production cutover gate

This branch is a staging/preview implementation, not a replacement for the MongoDB-backed production bot.
Do not merge/cut over to production until this checklist is green. Presence of a schema/table or endpoint wrapper
is not proof of feature parity.

## Required parity matrix (source of truth: `main`)

| Domain | Required behavior | Current verified state | Release gate |
|---|---|---|---|
| Economy / wallet | Read main balance, treasury and wallet IDs; every debit/credit is atomic and auditable | V2 remains isolated; Mini App wallet transfers now assign persistent `Bika<userId><5 letters>` wallet IDs and settle sender/recipient movement through one idempotent ledger row. Gift transfers no longer alter gambling win/loss counters. Real test-bot/concurrency/replay verification and production import are outstanding | Block production |
| `.slot` | Same `.slot amount` syntax, main RTP/promo fallback, VIP handling, limits, cooldown, cap and atomic settlement | Limits/cooldown/cap and RTP source/fallback are covered by CI; V2 slot spin odds/VIP branch and production interaction are not demonstrated as exact main parity | Partial; exact odds parity + runtime test required |
| `.bj` / Blackjack | Same bet range, cooldown, RTP control, per-user action guard, timeout/refund, natural payout and settlement lifecycle | Durable V2 rooms, version-guarded updates, stable payout/refund keys, 90s timeout and natural 2.5x policy are implemented; exact main target-result/dealer-forcing behavior and live Telegram/Mini App concurrency are not fully verified | Partial; runtime concurrency/replay test required |
| `.shan` | Same challenge/accept/cancel/expiry, room lifecycle, house cut, settlement and cleanup | V2 preview has basic create/join/draw/stay; exact main parity is unverified | Implement + test |
| `.dice` | Same challenge, accept/cancel, timer, participant validation, house cut and one-time payout | V2 now has persistent challenge creation, target-only acceptance, 60-second expiry, real Telegram dice, atomic two-player settlement, separate tie refunds and an idempotency key; isolated settlement-plan and real SQLite trigger tests are added, but CI execution, SDK/runtime and Telegram smoke tests remain | Run runtime + parity tests |
| `.mine` / `.mines` | Alias parity, board rules, first-pick protection, cashout, timeout, active-session uniqueness, one-time payout | V2 Mines preview exists; alias parity and concurrency/replay tests remain | Implement + test |
| Per-game `/on` and `/off` | Owner-only enable/disable controls for each named game; persisted config; enforced across commands, callbacks and Mini App APIs | V2 persists owner-only game switches. Writes now read back and verify enabled state, actor and timestamp; `/gamestatus` reports per-game audit metadata. `SERVERLESS_OWNER_TELEGRAM_ID` remains unset by default, and complete entry-point/active-session behavior still needs isolated runtime tests | Verify owner config + runtime tests |
| Auction | Create/post/edit bids, validation, increment, bid funds, expiry/finalization, refund/settle atomically, restart-safe scheduling | V2 implements owner-only text/photo/video posting, reply-based bids, minimum-increment validation, ledger-backed bid debit and previous-bid refund, idempotent seller payout/cancellation refund, and expiry reconciliation on inbound updates. It has no persistent scheduler, so exact-deadline finalization is not guaranteed; real Telegram, restart/race, treasury and retry/replay tests remain | Scheduler strategy + runtime tests |
| 2D | Main schedule/timezone, bets/caps, open/close/result publishing, exact payout/treasury reconciliation and idempotent settlement | Preview now parses `00–99`/reverse bets, checks Yangon weekday AM/PM windows, publishes an open post on inbound updates, gates betting to that post's linked discussion, writes debit+treasury+bet+position atomically through a single ledger row, caps each user/number at 200,000 Bal, and uses an idempotent 40x winner settlement. It still lacks a persistent scheduler: open/close work is reconciled only when an update arrives; real Telegram/thread, restart/race, and treasury payout tests remain | Partial preview; block production |
| Broadcast | Owner-only, text and reply-copy preserving media/caption/buttons, approved groups only, bounded rate/concurrency, retry/429 handling, progress/cancel, persistent lock/heartbeat | V2 now has persistent job/target snapshots, text/copy, approved-group filtering, 25/sec pacing, concurrency 8, retry/backoff, progress/cancel/resume and a durable lock. Each invocation handles at most 100 recipients; large jobs need explicit `/broadcast resume`, unlike main's running worker. Runtime, restart/race and Telegram 429 smoke tests remain | Finish automatic continuation strategy + runtime test |
| Group approval | Track groups, require bot admin, owner approve/reject/status and send only to approved groups | V2 records group state, verifies bot admin before approval, refreshes cached admin status every 60 seconds, and blocks non-owner traffic if the bot loses admin or status cannot be verified; runtime smoke test and broadcast integration remain | Runtime + broadcast integration test |
| Stars | Package selection, invoice, pre-checkout, verified payment, unique charge id, duplicate callback protection, refunds/reconciliation | Purchase path is wired; real payment/refund tests remain | Test before cutover |
| Other main domains | Promo/global RTP settings, daily rewards, shop/inventory/sell, tournaments, sports, admin/treasury, background jobs, group lifecycle | Sports event/betting/settlement, daily tournament, promo RTP and commerce service code exists, but exact `main` behavior, every permission/alias, concurrency/retry safety, scheduler guarantees, runtime Telegram flows, and admin/treasury parity are not fully verified. Daily reward range administration, production import, and background jobs remain incomplete or runtime-dependent | Verify exact parity + tests |
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
4. Test Auction transitions and 2D schedule reconciliation using a fake clock and process restart. Serverless V2 is event-driven, so exact-time 2D publish/close requires an external authenticated scheduler; do not claim exact schedule parity without it.
5. Test broadcast copy/text, approved-group filtering, 429/retry-after, permanent recipient failures, cancellation, stale lock recovery, and progress counters.
6. Test wallet ID creation/races, transfer insufficient balance, self-transfer, duplicate request IDs and replay behavior. Test 2D duplicate bets, concurrent per-number caps, closed-event rejection, retryable settlement and treasury-insufficient behavior. Test retention at cutoff boundaries while proving balances/settings/inventory/active operations/idempotency markers remain safe.
7. Reconcile source/target user counts, wallet IDs, every balance, treasury, outstanding wagers, pending payments and inventory after a dry-run import.
8. Exercise rollback and ensure exactly one writer handles money at every stage.
9. Require CI to run syntax, contract, unit and integration tests; static grep/regex checks alone are insufficient.

**Production status: BLOCKED** until the required matrix is implemented, tests pass, import/reconciliation is signed off, and rollback is proven.


## Maintenance mode (Serverless V2 preview)
- State is stored in the isolated `settings` table under `maintenance_mode`; missing setting defaults to OFF. A malformed non-null value fails closed as ON.
- Compatibility with main: `/off` enables maintenance; `/on` disables maintenance. Explicit Owner-only `/maintenance on|off|status` is also supported.
- Writes require `SERVERLESS_OWNER_TELEGRAM_ID` to be a valid numeric owner ID and verify the persisted value after writing. If owner ID is unset, control changes fail closed.
- While ON, non-owner Telegram commands and callback queries are blocked. Owner can still inspect/change the mode. Successful payment updates are processed before the maintenance gate so already-paid Stars purchases are credited.
- OFF is the default for a missing setting; OFF removes the command/callback gate on the next update. Normal Mini App actions pass through the shared dispatch maintenance gate, and the Stars invoice endpoint checks maintenance directly. End-to-end test-bot and provider/runtime verification are still required before production use.
