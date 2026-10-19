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

## Phase 2 — feature parity before any real data

The following are still blockers in V2 and must be implemented and tested against `main` contracts: complete slot/BJ/Shan/Mines game lifecycle parity, Dice gameplay, Auction state transitions and expiry, 2D schedules and settlement, broadcast text/copy/progress/cancel/429 handling, group approval, remaining admin/settings/commerce/sports/tournament/background jobs, and exact-once/concurrency/replay tests. See [SERVERLESS_V2_PARITY.md](SERVERLESS_V2_PARITY.md).

A passing syntax/parser/static-contract workflow is not proof that Telegram runtime, accounting, payment callbacks, auctions, 2D payouts or broadcast work end to end.

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
