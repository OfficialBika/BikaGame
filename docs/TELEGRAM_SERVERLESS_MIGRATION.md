# BIKA Game — Telegram Serverless migration

## Status

This branch is an isolated Serverless migration foundation, not a production cutover.

- Branch: feat/telegram-serverless
- Legacy production code and deployment files are intentionally unchanged.
- The new runtime modules live only under tgcloud/.
- The existing public/miniapp is not configured for Serverless hosting because it still calls Express routes that have not been ported.
- The preview schema belongs to Telegram Serverless's separate SQLite database. No MongoDB data is copied or read by this code.

## Ported in this first slice

- /start: creates/refreshes preview profile metadata only; grants no bonus.
- /help and /serverlessstatus.
- /balance /mybalance: read-only preview balance.
- /top10: preview-only leaderboard.
- Mini App endpoints getProfile and getLeaderboard. Telegram Serverless validates Mini App init data before invoking an endpoint; the code still checks for a verified user context.
- A separate SQLite schema for user profiles, transaction records, treasury and settings, ready for reviewed migration.

## Explicitly not ported / disabled

Do not treat these modules as ready simply because their data tables are scaffolded:

- Start bonus, daily claims and treasury settlement.
- Gifts, wallet transfers, Telegram Stars purchases/refunds and payment reconciliation.
- Slot, Mines, Crash, Dice, Shan, Blackjack, 2D, sports bets and all other wagering/payout flows.
- Promo RTP timers, auctions, tournament jobs, broadcasts, group approval, admin maintenance and scheduled/background jobs.
- Existing Mini App routes, wallet API, background music API, web crash routes and any frontend action that depends on Express.
- Production MongoDB imports and reconciliation.

In particular, money-moving features must retain the existing invariants: an idempotency key, user balance guard, treasury guard, durable ledger entry, and all-or-nothing settlement. Do not replace the old MongoDB transaction flow with a sequence of independent SQLite writes. Implement each settlement as an atomic, tested design before exposing it.

## Safe local preview setup

1. Clone this branch into a working directory.
2. Create a separate Telegram test bot in @BotFather; enable Serverless for that test bot. Do not link this branch to the live BIKA production bot yet.
3. Install/use the Telegram Serverless CLI (@tgcloud/cli) and log in with the test bot's Serverless CLI access token, not its Bot API token.
4. Run the checks described below before deploying anything.

The CLI credentials are stored under .tgcloud/, which is ignored by Git. Never commit a CLI token, bot token, MongoDB URI, or wallet/payment credential.

## Commands to validate against a test bot

Run these from the repository root after linking the test bot:

    npx --yes @tgcloud/cli status
    npx --yes @tgcloud/cli run handlers/message '{ message_id: 1, chat: { id: 10001, type: "private" }, from: { id: 10001, first_name: "Preview", is_bot: false }, text: "/start" }' --ctx '{ update: { update_id: 1 } }'
    npx --yes @tgcloud/cli run handlers/message '{ message_id: 2, chat: { id: 10001, type: "private" }, from: { id: 10001, first_name: "Preview", is_bot: false }, text: "/balance" }' --ctx '{ update: { update_id: 2 } }'
    npx --yes @tgcloud/cli run handlers/message '{ message_id: 3, chat: { id: 10001, type: "private" }, from: { id: 10001, first_name: "Preview", is_bot: false }, text: "/top10" }' --ctx '{ update: { update_id: 3 } }'

The platform-run checks require a configured Serverless test bot. Local repository CI checks only syntax and contract boundaries; they do not claim to validate a live Telegram deployment.

When ready to test schema changes, review npx --yes @tgcloud/cli diff, then use npx --yes @tgcloud/cli push and explicitly review npx --yes @tgcloud/cli migrate --dry-run before applying any migration. Never use --force as a substitute for reviewing state. Deployment and database migration are separate actions.

## Production data migration plan

Do not switch live users until all steps are signed off:

1. Freeze a source snapshot from MongoDB and record counts/totals for users, transactions, treasury, orders/shop cards, bets, events, auctions and settings.
2. Map and normalize Mongo IDs and numeric/string Telegram user IDs without collapsing distinct records.
3. Build a dry-run importer that writes to a separate target database and emits a reconciliation report. No source records are modified or deleted.
4. Compare user counts, aggregate balances, treasury balance, ledger sums, payment payload/idempotency markers, open bets and active event state.
5. Test retry/replay behavior, Telegram Stars duplicate payment updates, concurrent transfers, failed writes, and rollback/forward recovery.
6. Port and test all required Mini App endpoints before setting static in tgcloud.jsonc.
7. Cut over only with a planned maintenance window, a validated snapshot, a documented rollback point and explicit approval. Avoid running two writable economies at the same time.

## Data compatibility notes

The initial schema is a clean Serverless preview schema, not an automatic MongoDB schema conversion. Telegram Serverless uses its own SQLite-backed database and a constrained runtime: imports must stay within tgcloud/ with .js extensions, and runtime code cannot use ordinary Node/npm packages or filesystem APIs. The existing Express + Telegraf + MongoDB app remains the production fallback until the remaining modules are ported and tested.
