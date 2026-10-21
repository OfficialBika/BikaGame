# BIKA Mini App v2 — Implementation status

Date: 2026-10-21

## Branch and commits
- Branch: `feat/miniapp-v2-android`
- Parent/base: `feat/db-two-bot`
- Current reviewed head: `0bd3bd484999cbf8a059e39a5a3cae091538141c`
- CI: `https://github.com/OfficialBika/BikaGame/actions/runs/39545450024` — passed

## Current deliverables
- `public/miniapp/v2/index.html`: isolated v2 preview entry
- `public/miniapp/v2/v2.css`: responsive Premium Neon Arena + Vibrant Arcade UI, five-tab navigation, safe-area padding, reduced-motion support
- `public/miniapp/v2/v2.js`: local navigation, search/filter, Telegram WebApp detection, and clearly labeled demo-only Rocket Crash selection
- `public/miniapp/v2/README.md`: preview and rollout guardrails
- `.github/workflows/syntax-check.yml`: CI for the branch, including v2 asset and preview-safety checks
- `src/web/miniAppRoutes.js`: an opt-in `/miniapp/v2` route was added while restoring the complete original route file

## CI note
An intermediate route commit accidentally truncated `src/web/miniAppRoutes.js`; CI caught it. The full file from `feat/db-two-bot` was restored, and the v2 route was reapplied as a minimal change. The current head's CI passes. Do not cherry-pick the intermediate failing commits.

## Current limits
- The UI is a preview only and makes no real bets.
- It does not yet read real profile/balance/activity APIs.
- Rocket Crash is not live-integrated.
- Browser and physical Android/Telegram WebView testing are not yet complete.
- Do not merge into `main` until all integration, regression, and Android QA gates pass.

## Next
1. Audit and simplify the v2 client JS, add interaction/browser tests.
2. Verify the v2 path on a deployed preview branch.
3. Wire read-only profile/balance/history with the existing server contracts.
4. Integrate Rocket Crash endpoints without changing server financial/game logic.
5. Complete financial regression tests and Android Telegram QA.
