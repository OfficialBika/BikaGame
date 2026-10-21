# BIKA Mini App v2 Preview

This directory contains the isolated Android-first Mini App v2 UI prototype.

## Files
- `index.html`: standalone UI preview entrypoint.
- `v2.css`: responsive premium neon + vibrant arcade presentation layer.
- `v2.js`: local navigation, game filtering, Telegram WebApp detection, and demo-only Rocket Crash interaction.

## Preview URL
When `feat/miniapp-v2-android` is deployed, open `/miniapp/v2/` on that deployment. This preview is deliberately separate from the current `/miniapp` entrypoint.

## Safety boundary
This is not connected to real game or wallet endpoints. All balances and game states are placeholders. The Rocket Crash action is demo-only and never places a bet. Do not expose this preview as the production Mini App until the integration and regression test phases are complete.

## Integration sequence
1. Inventory and document existing endpoints, auth rules, game states, and financial invariants.
2. Connect read-only profile/balance/live status/history using existing server contracts.
3. Integrate Rocket Crash using the existing server-authoritative APIs.
4. Run UI/API, Telegram authentication, idempotency, wallet/ledger, DB1/DB2, and Android viewport tests.
5. Migrate remaining games one at a time; keep a rollback path.

No wallet, bet, payout, ledger, treasury, database, or other business logic was changed for this preview.
