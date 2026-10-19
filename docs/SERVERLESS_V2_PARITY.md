# Serverless V2 Bot — parity and cutover checklist

The branch starts from current `main`. Serverless-only additions are isolated under `tgcloud/`; the production `src/` and package/runtime setup are unchanged.

## Atomic accounting
New balance-changing operations are single INSERTs into `transactions`. SQLite triggers enforce sufficient user/house balance, update `users.balance`, win/loss totals and treasury, and write game history/payment markers inside the same SQLite transaction. Do not update `users.balance` directly in any V2 handler. Transfers use a single transaction row with sender/recipient account IDs.

## Three-day retention
The Serverless economy layer prunes visible history, old ledger rows and completed sessions/bets/orders on traffic with a three-day cutoff. Compact idempotency keys and minimal Telegram charge identifiers remain as replay protection; deleting them would enable duplicate payouts or replayed payment credits. User balances, treasury, settings, inventory and active orders/bets must remain durable.

## Current state
- Atomic ledger/treasury trigger infrastructure and major main-domain target tables: added in V2.
- Slot odds/RTP and one-row game settlement: port in progress.
- Plinko/Wheel/Daily Wheel: port in progress.
- Crash/Mines/Blackjack/Shan: session logic still needs exact main parity and concurrency/replay tests.
- Stars, 2D, sports, shop/inventory/sell, auctions, tournaments, admin, broadcast, group approval, background jobs and production snapshot import: not yet fully ported.

## Cutover gate
Do not point live traffic at V2 until every main feature has a matching test, concurrent requests/retries cannot duplicate settlement, Stars purchase/refund flows are verified, source and target balances/treasury reconcile, retention is exercised, and a rollback with single-writer cutover is tested. Schema migration alone does not import production data.
