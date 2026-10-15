# BIKA Game — Telegram Serverless migration

## Current status

This branch is an isolated Serverless migration and test branch, not a production cutover.

- Branch: \`feat/telegram-serverless\`
- Existing Express/Telegraf/MongoDB production files are intentionally preserved.
- Telegram Serverless modules live under \`tgcloud/\`.
- The Serverless app is linked to a dedicated test bot; the first preview database migration created the original four tables.
- \`tgcloud.jsonc\` configures \`public/miniapp\` for static hosting. Telegram Serverless serves this directory from the domain root, while the legacy Express app used the \`/miniapp/\` URL prefix. The patch script rewrites those static asset paths for the Serverless host.
- The patch script also routes Mini App API calls through \`Telegram.WebApp.Serverless.call()\`.

## Ported preview surface

### Bot commands

The Serverless preview currently contains:

- \`/start\`, \`/help\`, \`/serverlessstatus\`
- \`/balance\` / \`/mybalance\`, \`/top10\`, \`/wallet\`
- \`/daily\`, \`/transfer\` (preview currency only)
- \`/slot <bet>\`, \`/plinko <bet>\`, \`/wheel <bet>\`
- \`/mines <bet>\` with callback controls
- \`/crash <bet>\` with cash-out callback
- \`/blackjack <bet> [room]\` with hit/stand callbacks
- \`/shan <bet> [room]\` with action callbacks

### Mini App endpoint files

Serverless endpoint modules exist for the preview Mini App surface:

- Config, profile, history and leaderboard
- Wallet, wallet lookup and read-only transfer history
- Wallet transfer endpoint is intentionally disabled; it must not make separate balance and ledger writes
- Slot, Plinko, Lucky Wheel and daily wheel
- Rocket Crash start/bet/status/cashout
- Mines start/status/open/cashout
- Web Blackjack status/join/hit/stand
- Web Shan create/status/join/draw/stay/deal
- Background-music compatibility response

These modules use the independent Serverless SQLite database. They do not read or write production MongoDB.

## Production parity boundary

The migration is **not yet a complete behavioral replacement of all production systems**. Preview game/economy logic is for isolated testing and must not be treated as production-money code. Do not cut over the live bot or live Mini App until these are ported and tested with the existing business rules:

- Source MongoDB import and reconciliation of users, balances, treasury and transaction ledgers.
- Telegram Stars purchases/refunds and payment reconciliation.
- Character/card shop, sell and inventory systems.
- 2D betting and settlement, sports betting/event feeds.
- Auctions, tournaments, Promo RTP controls and scheduled/background jobs.
- Broadcast, group approval, admin/maintenance and owner-only operations.
- Exact game result, multiplayer-room, payout and settlement parity.

Any balance-changing transaction must be safe under retries and concurrent requests, with durable idempotency and all-or-nothing settlement. Do not expose a partially ported economy in production. Keep the legacy production runtime unchanged as the rollback path.

## Mini App patch

Run this from the repository root after pulling the branch:

    node scripts/patch-miniapp-serverless.mjs

The script is idempotent. It modifies the working copies of \`public/miniapp/index.html\`, \`app.js\`, \`app-core.js\`, and any HTML/JS/CSS file that contains legacy \`/miniapp/\` asset URLs. It preserves the existing UI, changes the API adapter to Serverless endpoint calls, and rewrites static asset paths to work from the Serverless domain root. These local generated changes are expected for a Serverless test deployment.

Do not configure the production Mini App URL to the test app. Use only the dedicated test bot while validating this branch.

## Validation and test order

Run from the repository root:

    npm run check
    node scripts/patch-miniapp-serverless.mjs
    node scripts/patch-miniapp-serverless.mjs
    node scripts/check-serverless-contract.mjs
    find public/miniapp -type f -name '*.js' -print0 | xargs -0 -n1 node --check
    npx tgcloud status
    npx tgcloud diff

The second patch invocation verifies idempotency. The contract checker checks module imports, endpoint file coverage, API-to-endpoint mappings, Serverless call adapters, static configuration and root asset paths.

Only after those checks pass, deploy to the linked **test bot**:

    npx tgcloud push
    npx tgcloud migrate --dry-run

Review the full diff and migration output. The current database already has the original four preview tables, so additional schema changes may be pending. Apply them only after verifying they are additive and expected. Code deployment and database migration are separate actions. Never use \`--force\` to bypass a deployment-state conflict.

## Production cutover rule

Do not switch the live BIKA bot or Mini App yet. Before any production cutover, freeze a MongoDB snapshot, reconcile user counts and aggregate balances, treasury, ledger/payment markers, open bets and events; port the remaining systems; test retries, replays, concurrent settlement and failure recovery; and obtain explicit approval for a planned cutover with a rollback point.

Telegram Serverless runs JavaScript in an isolated runtime with the platform SDK and its own SQLite-backed database. It does not provide the existing Express, Telegraf, npm-package or MongoDB runtime. The original production application remains the fallback until the remaining features pass parity testing.
