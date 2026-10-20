# Transaction retention policy

## Decision

Do not apply a TTL index or scheduled delete to the entire `transactions` collection.

The collection contains both:
- user-visible financial ledger records (payments, transfers, bets, wins, refunds, admin balance adjustments);
- internal idempotency/settlement records whose `_id` values start with `__settlement:` or `__stars_purchase:`.

These records are referenced by payment and game-settlement paths. In particular, the 2D settlement verifier aggregates `2d_win` ledger rows from `transactions` and compares row count and payout total to the stored event results. Deleting these rows after three days would make that verifier fail for older events.

## Safe policy

1. Keep financial ledger rows indefinitely unless an explicit, tested archival and verification strategy is approved.
2. Do not automatically delete settlement or payment markers until every reader/writer has been migrated to a separate idempotency collection and tested.
3. If the goal is to reduce Atlas M0 quota usage, first export/archive ledger history outside the quota-limited cluster and build a tested read path for archived history. Archival does not itself reduce quota until the corresponding live ledger rows are intentionally removed.
4. Use TTL only for genuinely temporary event/history collections where code confirms that expired rows are not used for financial reconciliation, idempotency, or recovery. The current `web_game_history` service already uses a 24-hour TTL by default in its own collection.
5. Any destructive cleanup must be preceded by a verified backup/export, staging test, document-count and balance reconciliation, and a rollback plan.

## Important code dependencies

- `src/services/starsBalanceService.js`: checks `__stars_purchase:<chargeId>` markers to prevent crediting the same Stars payment twice.
- `src/services/economyService.js`: uses `__settlement:` marker records to guard settlements and logs financial transfers.
- `src/services/twoDService.js`: verifies completed 2D payouts by aggregating `2d_win` ledger rows in `transactions`.
- `src/commands/user/daily.js`: uses settlement marker documents for daily claims.
- `src/services/sportsEventService.js` and `src/services/webWheelService.js`: use settlement markers for recovery/idempotency.
- `src/services/webBetHistoryService.js`: stores disposable gameplay presentation history separately and applies a TTL index to that collection.

This document intentionally does not add an automatic deletion job. Deleting all transactions or all records older than three days is unsafe with the current code.
