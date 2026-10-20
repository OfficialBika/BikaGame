# Serverless V2 deployment and MongoDB migration runbook

## Current architecture (do not skip)

`SeverLess-V2-Bot` is a Telegram Serverless preview. Its handlers use Telegram Serverless' built-in SQLite-backed database through `sdk/db`, declared in `tgcloud/schema.js`. The production `main` bot uses MongoDB-backed services in `src/`. These are different persistence layers.

Setting `MONGO_URI` alone does not connect the V2 handlers to MongoDB: the V2 handlers do not use the MongoDB driver. Do not describe this branch as MongoDB-migrated, and do not route production money traffic to it while `productionDataImported` is false.

## Phase 0 — protect production

- Do not deploy this branch to the current live bot project yet. A Serverless push updates the code for the bot linked to that project.
- Do not reuse a production bot token with a second polling process or alter its webhook while testing.
- Create a separate test bot in BotFather, enable Serverless for that test bot, and link a separate local clone/worktree to its Serverless CLI access token. This CLI token is separate from the Bot API token.
- Use only the test bot and its isolated Serverless database for all initial smoke tests. Never test wagers or Stars against production accounts/data.
- Keep `main` and the production MongoDB untouched.

## Phase 1 — configure and deploy the preview bot

1. In `tgcloud/lib/config.js`, set `SERVERLESS_OWNER_TELEGRAM_ID` to the numeric Telegram user ID of the owner for the test bot. Its committed default is `0`, which intentionally blocks toggle writes until configured.
2. Review the branch diff and run the Serverless CLI checks against the test bot project.
3. Run `npx tgcloud status` and `npx tgcloud diff`; confirm the linked app is the test bot, not the live bot.
4. Push the code to the test bot only. Review and separately apply schema migrations when prompted; do not blindly apply destructive changes.
5. For the Dice tie-refund ledger change, confirm the reviewed schema migration adds the `transactions.refunds` JSON column before invoking handlers. The current implementation installs additive `bika_transactions_refunds_before_insert` and `bika_transactions_refunds_after_insert` triggers alongside the existing ledger triggers; startup must not drop/recreate live balance triggers. If schema migration status is uncertain, do not run money-changing smoke tests until the preview schema is confirmed.
6. Run `npx tgcloud diff` and `npx tgcloud migrate` explicitly after schema deployment, and record the migration result. A successful `push` alone does not apply database changes.
7. Run handler tests locally with `npx tgcloud run handlers/message ...` and run the parser/contract CI. Then perform Telegram smoke tests using test balances only.
8. Test unauthorized users cannot toggle games; owner can enable/disable each supported control; settings survive invocations; Mini App routes reject starts for disabled games; active-round cashout/action callbacks remain available.
9. Record the test bot's app ID, commit SHA, schema version, and test results before proceeding.

## Broadcast preview implementation

The Serverless preview now has a durable broadcast job, target snapshot, lock/heartbeat record, progress counters and resumable batches. Its current policy is bounded to 100 targets per invocation, 8 workers, at most 25 sends per second, and up to four attempts for retryable Telegram errors. It supports owner-only text broadcast and reply-copy (copyMessage) to users plus groups whose approval status is approved only.

This is not yet identical to the production long-running worker: once the batch cap is reached, the owner must use `/broadcast resume` to continue. Verify this behavior and the SDK's DB/Telegram method return shapes against a separate Serverless test bot before relying on it. Do not execute `npx tgcloud push` or `npx tgcloud migrate` against the production-linked app.

The Broadcast implementation adds the `broadcast_targets` and `broadcast_locks` tables. Review the generated schema migration before applying it to the test app, verify the target/lock indexes and JSON payload columns, and test a rollback plan. The existing `broadcast_jobs` table alone is not enough to run this worker.
## Phase 2 — feature parity before any real data

The following remain production blockers even where V2 service code now exists: exact `main` behavior and lifecycle parity for Slot/BJ/Shan/Mines; real Telegram verification of Dice Duel's persistent challenge and atomic settlement; Auction posting/bidding/refund/payout flows plus a scheduler that guarantees deadline finalization; exact-time 2D open/close/result scheduling; fully automatic broadcast continuation beyond the 100-target invocation cap; and remaining admin/settings/commerce/sports/tournament/background-job parity. Run behavior-level exact-once, concurrency, retry/replay and restart tests for every money-changing path. See [SERVERLESS_V2_PARITY.md](SERVERLESS_V2_PARITY.md).

The CI workflow now includes syntax/import/contract checks, policy tests and isolated SQLite trigger tests for ledger settlement, wallet transfers, daily claims, 2D bets, Stars purchases and event-market accounting. These tests validate isolated rules only: they do not prove Telegram SDK/runtime return shapes, real Stars checkout/refunds, callback authorization end to end, scheduler guarantees, broadcast 429 behavior or production data migration.

## Phase 3 — choose the database destination before migration

There are two different possible end states; choose one deliberately.

### A. Keep MongoDB as production source of truth

Continue running the existing MongoDB-backed `main` bot for production and port/fix features inside that runtime. Do not merge the isolated Serverless database model into production without a separate plan.

### B. Move production records from MongoDB into Telegram Serverless SQLite

This is a database migration, not a connection-string change. Before it can be approved:

- Inventory all source MongoDB collections, indexes, unique keys, TTL rules, ObjectId fields, date/timezone handling, and every code path that reads or writes them.
- Create explicit source-to-target mappings for users, wallet IDs, balances, treasury, settings, game/history records, active wagers/sessions, 2D events/bets, auction state/bids, groups/approval, inventory/orders, payment events, and replay/idempotency keys.
- Write a repeatable, read-only-first export and a dry-run import/reconciliation report. Never export credentials, bot tokens, payment secrets, or unrelated private fields.
- Check field types and constraints (MongoDB IDs, numeric Telegram IDs, timestamps, status enums, unique keys) and produce row counts, skipped/invalid records, and a checksum/report for each collection.
- Reconcile every user's balance and the treasury, plus all outstanding bets/wagers, unsettled auctions, pending/refundable Stars payments, inventory ownership and group approval. Do not import a partial snapshot and call it complete.
- Run import against a disposable test database, repeat it to prove idempotency, simulate interrupted/retried imports, and prove there are no double credits or missed debits.
- Freeze or quiesce money writes during final snapshot/cutover, establish a single writer, perform final reconciliation, verify smoke tests, and have a tested rollback to the previous MongoDB bot/database.
- Preserve the source database and backup read-only until the new system is verified over an agreed observation period.

Do not delete source MongoDB records or change the live bot webhook until the migration owner approves the reconciliation report and rollback plan.

## Go/no-go checklist

- [ ] Test bot is isolated from production.
- [ ] Owner ID is configured without runtime environment-variable assumptions.
- [ ] Handler and endpoint tests pass.
- [ ] Each main feature has behavior-level parity tests.
- [ ] Duplicate callbacks, concurrent requests, retries after ambiguous timeouts and insufficient-balance paths are verified.
- [ ] Auction/2D scheduled transitions survive restarts and produce exactly-once settlement.
- [ ] Broadcast handles rate limiting, permanent recipient errors, cancellation and approved-group filtering.
- [ ] Database dry-run/import report is reconciled and repeatable.
- [ ] Single-writer cutover and rollback are tested.
- [ ] Production cutover explicitly approved.

Until every applicable item is green, production cutover remains BLOCKED.
