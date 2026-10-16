# BIKA Game — Telegram Serverless migration

## Status

This is an isolated migration/test branch, not a production cutover. The existing Express/Telegraf/MongoDB files and deployment config remain unchanged.

- Branch: `feat/telegram-serverless`
- Bot handlers and API endpoints live under `tgcloud/`; Mini App static hosting is configured in `tgcloud.jsonc`.
- The test bot has a separate Serverless SQLite database. No production MongoDB data has been imported.
- CI checks production syntax, the Serverless runtime import contract, Mini App static-root paths, API endpoint mappings and patch idempotency.

## Connected preview surface

### Telegram commands
- `/start`, `/help`, `/serverlessstatus`, `/features`, `/play` (opens the test Mini App)
- `/balance` / `/mybalance`, `/wallet`, `/top10` / `/leaderboard`, `/history`
- `/daily` (preview reward only)
- `/slot <bet>`, `/plinko <bet>`, `/wheel <bet>`
- `/crash <bet>` with cash-out callback
- `/mines <bet>` with tile/cash-out callbacks
- `/blackjack <bet> [room]` with hit/stand callbacks
- `/shan <bet> [room]` with draw/stay callbacks

### Mini App endpoint surface
The endpoint modules are mapped to `Telegram.WebApp.Serverless.call()` for profile, config, history, leaderboard, feature status, wallet read/lookup/history, Slot, Plinko, Wheel, Daily Wheel, Crash, Mines, Blackjack, Shan and the background-music compatibility response. The Mini App navigation exposes a Features view that reads the same feature registry as the bot's `/features` command.

These are **preview implementations**, not a replacement for production game math, multiplayer settlement or production balances. Bet validation now rejects invalid inputs; debits use a conditional balance update to stop concurrent overspend; Daily Wheel uses a conditional claim update to stop duplicate daily claims. Ledger writes still follow the balance write as a separate operation in the preview runtime, so money-moving production features remain disabled pending a verified all-or-nothing design.

## Explicitly not migrated / disabled

- Production MongoDB user/balance/treasury/ledger data import and reconciliation.
- Telegram Stars purchase/refund and payment replay reconciliation.
- Wallet transfers and gifts pending atomic sender + recipient + ledger settlement.
- Character/card shop, inventory, sell, and order processing.
- 2D betting/events/settlement and sports event feeds/betting.
- Auctions, tournaments, Promo RTP controls and scheduled/background jobs.
- Broadcasts, group approval, admin/owner controls and maintenance operations.
- Exact parity for all production bot commands and game outcomes.

The `/features` command and the authenticated Mini App `featureStatus` endpoint report these statuses rather than returning fake success for unported features.

## Mini App patch and test commands

Run these from the repository root after pulling:

    npm run check
    node scripts/patch-miniapp-serverless.mjs
    node scripts/patch-miniapp-serverless.mjs
    node scripts/check-serverless-contract.mjs
    find public/miniapp -type f -name '*.js' -print0 | xargs -0 -n1 node --check
    npx tgcloud status
    npx tgcloud diff

The patch script rewrites legacy `/miniapp/` asset paths for the Serverless domain root and adapts `/api/mini/*` calls to Serverless endpoint calls without replacing the UI. The second run checks idempotency.

For test deployment only, review `npx tgcloud diff`, then run `npx tgcloud push`, and inspect `npx tgcloud migrate --dry-run`. Do not apply schema changes until the full additive diff is understood. Do not use `--force` to bypass deployment state conflicts.

## Production cutover gate

Do not connect the live bot/Mini App to this branch yet. Before cutover, import a frozen MongoDB snapshot into a separate target, reconcile users/balances/treasury/transactions/payments/open bets/events, port the remaining subsystems, test duplicate updates and concurrent settlement, and perform a planned cutover with rollback. Never run two writable economies in parallel.
