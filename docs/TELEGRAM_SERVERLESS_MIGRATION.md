# BIKA Game — Telegram Serverless migration

## Status

This branch is an isolated migration and hardening branch. It is **not live-economy capable and not approved for production cutover**. The production Express/Telegraf/MongoDB runtime and all existing deployment settings remain unchanged.

- Preview app: `app8694856110`
- Working branch: `feat/telegram-serverless-hardening`
- Serverless handlers/modules remain under `tgcloud/`; the existing Mini App UI stays under `public/miniapp/`.
- The Serverless app uses its own platform database. Production MongoDB records, balances, treasury, transactions, payment history and open bets have not been imported or reconciled.
- Read-only account/profile/feature screens can be validated in isolation. Any endpoint/command that changes a balance is currently deliberately disabled.

## Safety hardening applied

- Bet arguments are rejected unless they are safe positive integers inside configured limits.
- Daily claim uses a conditional update so a duplicate same-day claim is rejected.
- Crash and Mines cashout use conditional active-session transitions, preventing concurrent requests from both winning the same session transition.
- Idempotency keys are used for game debit/payout ledger entries.
- The balance-mutating settlement helper fails closed with `ATOMIC_SETTLEMENT_UNAVAILABLE`: the supported preview SDK path has not been proven to provide a single atomic operation for balance + ledger + game result. It must not be bypassed or silently treated as production-safe.
- Mini App balance-changing endpoints and Telegram game commands are disabled until a verified atomic settlement primitive exists. This is intentional safety behavior, not a missing UI wiring bug.
- CI contract assertions check that disabled actions stay disabled and the live-economy flag remains false.

## Not yet migrated / not ready for real funds

- A verified production data export/import pipeline and reconciliation of user IDs, balances, VIP/bonus/daily state, treasury, ledger, payments, orders, inventory, 2D/sports bets and open sessions.
- A truly atomic settlement mechanism covering balance, transaction ledger, treasury, game result/history and the state transition, with idempotent retries and recovery after interrupted operations.
- Telegram Stars invoice generation, successful-payment verification, payload/charge ID validation, duplicate charge protection, refund handling and reconciliation.
- Wallet transfers/gifts with atomic sender debit + recipient credit + one ledger settlement.
- Production-equivalent Slot/Plinko/Wheel/Crash/Mines/Blackjack/Shan logic and multiplayer lifecycle, including race/replay tests.
- Card shop/inventory/sell/orders, 2D betting, sports, auctions, tournaments, Promo RTP, admin/owner actions, broadcast/group approval and background/scheduled tasks.
- Cutover plan with a frozen source snapshot, independent target audit, rollback path and explicit single-writer switchover.

## Verification commands

Run from the repository root after pulling this branch:

    npm run check
    node scripts/patch-miniapp-serverless.mjs
    node scripts/patch-miniapp-serverless.mjs
    node scripts/check-serverless-contract.mjs
    find tgcloud -type f -name '*.js' -print0 | xargs -0 -n1 sh -c 'node --input-type=module --check < "$0"'
    find public/miniapp -type f -name '*.js' -print0 | xargs -0 -n1 node --check
    npx tgcloud status
    npx tgcloud diff
    npx tgcloud migrate --dry-run

Do not run `npx tgcloud migrate` or deploy updated modules until reviewing the complete schema diff and confirming the intended app/database. Do not link the production bot token to a test/preview app. Do not point the preview runtime at production MongoDB credentials.

## Production cutover gate

Do not switch production traffic to this branch yet. A successful syntax/contract CI run only verifies the stated contract; it does not prove transactional behavior in the live Serverless runtime, production data parity, payment correctness or load behavior. Before a cutover, complete the work above, validate duplicate updates and concurrent settlements against an isolated target, run end-to-end payment/reconciliation tests, compare source/target financial totals, and then cut over once with a tested rollback plan. Never run two writable economies in parallel.
