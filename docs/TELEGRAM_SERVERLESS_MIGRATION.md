# BIKA Game — Telegram Serverless migration

## Current status

This branch remains an isolated Serverless migration/test branch. It is **not a production cutover**.

- Branch: `feat/telegram-serverless`
- Legacy Express/Telegraf/MongoDB production code is intentionally unchanged.
- Telegram Serverless modules live under `tgcloud/`.
- The Serverless project is linked to the dedicated test bot and the first preview database migration was applied successfully.
- Mini App hosting is configured to serve `public/miniapp`.
- A migration patch script is included to replace the legacy `/api/mini/*` calls with `Telegram.WebApp.Serverless.call()`.

## Ported in this migration slice

### Bot

- `/start`
- `/help`
- `/balance` / `/mybalance`
- `/top10`
- `/daily`
- `/wallet`
- `/transfer <wallet_id> <amount>` (preview wallet IDs are Telegram user IDs)
- `/slot <bet>`
- `/plinko <bet>`
- `/wheel <bet>`
- `/mines <bet>` plus callback controls
- `/crash <bet>` plus cash-out callback
- `/blackjack <bet> [room]` plus hit/stand callbacks
- `/shan <bet> [room]` plus draw/stay callbacks
- `/serverlessstatus`

### Mini App endpoint surface

The Serverless branch now contains endpoint modules corresponding to the existing Mini App game surface:

- config/profile/history/leaderboard
- wallet/lookup/transfer
- slot
- Plinko
- Lucky Wheel and daily wheel
- Rocket Crash start/bet/status/cashout
- Mines start/status/open/cashout
- Web Blackjack status/join/hit/stand
- Web Shan create/status/join/draw/stay/deal
- background-music compatibility endpoint

The endpoint layer uses the isolated Serverless SQLite database and never reads the production MongoDB database.

## Important parity boundary

The branch is **not yet an exact behavioral replacement for every production subsystem**. The following require separate parity work and must remain disabled for production cutover until their MongoDB logic, idempotency, concurrency and reconciliation behavior has been ported and tested:

- Production MongoDB data import/reconciliation.
- Telegram Stars purchase/refund/payment reconciliation.
- Character/card shop, sell and inventory systems.
- 2D betting and settlement.
- Sports betting/event feeds.
- Auctions and tournaments.
- Promo RTP controls and scheduled/background jobs.
- Broadcast/group/admin systems.
- Any production treasury operation.

Do not treat the preview game implementations as production-money logic. They are isolated test implementations used to validate the Serverless runtime and Mini App wiring first.

## Mini App migration

The existing frontend calls Express paths such as `/api/mini/me` and `/api/mini/slot/spin`. Telegram Serverless endpoints are invoked by name through `Telegram.WebApp.Serverless.call()` instead. The repository includes:

    scripts/patch-miniapp-serverless.mjs

Run it once after pulling the branch. It patches the existing `public/miniapp/app.js` and `public/miniapp/app-core.js` without replacing the existing UI.

## Validation order

From the repository root:

    npm run check
    node scripts/check-serverless-contract.mjs
    node scripts/patch-miniapp-serverless.mjs
    npm run check
    node scripts/check-serverless-contract.mjs
    npx tgcloud diff
    npx tgcloud push
    npx tgcloud migrate --dry-run

Review the migration output before applying it. For the test bot, additive tables are expected. Never use `--force` to bypass a concurrency conflict.

## Production cutover rule

Do not switch the live BIKA bot or Mini App yet. Before production cutover, freeze a MongoDB snapshot, reconcile users/balances/treasury/ledger/payments/open bets/events, port the remaining subsystems, test retry/replay and concurrent settlement behavior, and obtain explicit approval for the cutover.

Telegram Serverless uses an isolated SQLite-backed database and runs JavaScript in an isolated runtime with the platform SDK; it does not provide the existing Node/npm/MongoDB environment. The production application therefore remains the fallback until parity testing is complete.
