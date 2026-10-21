# Preview route integration note

The v2 UI lives in its own directory at `public/miniapp/v2/`.

Current confirmed behavior:
- `index.html`, `v2.css`, and `v2.js` exist as independent assets.
- The existing Express server exposes `/miniapp` via a route, and serves the directory's static assets under `/miniapp`.
- The UI prototype has no live wallet/game API calls.

Before treating `/miniapp/v2/` as available on a deployment, add and test an explicit server route for `/miniapp/v2` that sends `public/miniapp/v2/index.html`. A prior attempt to update `src/web/miniAppRoutes.js` through GitHub's contents API returned a SHA conflict, so that backend change was deliberately not forced. Re-fetch the exact branch-head file, prepare a minimal route-only diff, then run CI and review the resulting diff before any merge.

Do not change game handlers, Telegram auth middleware, wallet/ledger, bet, payout, treasury, database configuration, or retention policy for this route addition.
