# Bika Game Mini App — UI v16.3

## Navigation direction
- Home: featured games, wallet summary, quick launch.
- Games: all game launchers in one place.
- History: consolidated game history entry point.
- Ranking: leaderboard shell backed by real data only.
- Profile: player identity, balance and account actions.

## Current safe baseline
- Branch: `ui/premium-miniapp-v16`
- Existing game panel IDs and API contracts remain unchanged.
- v16.1 and v16.2 are visual/UX-only CSS improvements.

## Next implementation rule
The v16.3 navigation must be wired through the existing `openPanel()` flow and must not rename or remove game panel IDs (`crash`, `slot`, `blackjack`, `shan`, `plinko`, `wheel`, `mines`).
