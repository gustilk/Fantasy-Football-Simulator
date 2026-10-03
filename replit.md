# Gridiron Sim

A saved NFL season library and fantasy matchup lab: full rosters, raw weekly player/team statistics, and history-based Half-PPR simulations.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the managed API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `PORT=8080 BASE_PATH=/ pnpm --filter @workspace/gridiron-sim run build` — standalone frontend build check; managed artifact workflows supply these routing variables automatically.
- The simulator runs in the browser and requires no external sports feed or user API keys.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/gridiron-sim/src/App.tsx` — setup, recent-stat forms, results, and saved-run UI.
- `artifacts/gridiron-sim/src/lib/simulator.ts` — seeded probability model and scoring rules.
- `artifacts/gridiron-sim/src/index.css` — responsive visual styling.
- `artifacts/gridiron-sim/src/components/TeamLibrary.tsx` — saved roster and weekly data entry.
- `artifacts/gridiron-sim/src/lib/season-model.ts` — historical cutoff, averages, home/away splits, and record derivation.
- `artifacts/gridiron-sim/src/lib/ensemble.ts` — averages/ranges across simulation seeds.
- `lib/api-spec/openapi.yaml` — source of truth for season-team API contracts.

## Architecture decisions

- The Team Library accepts raw weekly game totals, while manual one-game setup accepts per-game averages. Historical inputs blend recent-five and season averages and, when available, home/away splits. **Why:** weekly data should be entered once and reusable, without pretending historical averages guarantee a future box score.
- Only played weeks strictly before the selected matchup are used; blanks remain unknown and missing player rows are DNP/unknown, not zero. **Why:** avoid future-data leakage and false low averages from byes or missing entries.
- Explicit team defensive totals override sums from individual defenders. **Why:** the same sack or interception must not be counted twice.
- Team rosters/history are atomic versioned database documents. **Why:** a stale browser must receive a conflict rather than overwrite another session's entered statistics.
- Free-text injury/context notes are displayed but not automatically interpreted. **Why:** heuristic text parsing could silently misread availability; the user should adjust ratings explicitly.
- No live NFL roster or injury feed is claimed. Example player labels must be updated by the user.
- Half-PPR follows the user's exact supplied formula, which does not specify interception or fumble deductions. Kicking points are outside that formula.

## Product

- Two sections: Team Library and Game Simulator.
- All 32 teams, separate seasons, full offense/defense rosters, individual and bulk roster entry.
- 18 weekly slots for 17 regular-season games plus a bye; player game totals, custom numeric metrics, and team defense totals.
- Saved-history mode includes all active QB/RB/WR/TE players, with the most-used QB starting, rather than a fixed six-player roster.
- Records are derived from entered earlier results. Weather, home field, and game importance make small, bounded heuristic adjustments.
- Every new run summarizes 200 games with mean Half-PPR and 10th–90th percentile model outcomes; score and drive log are one illustrative run.
- Settings and up to 10 runs persist in this browser; reopening a new saved run restores its input setup.

## User preferences

The user wants two sections: enter and save all offensive and defensive players and their weekly stats for each team, then automatically reuse those stats when simulating matchups.

For internet-sourced 2026 data, the user wants players' team assignments and offensive/defensive statistics from the last three completed games, not a full-season dataset.

The app's palette is background #0f1a13, cards #16251b, text #e9e8de, muted text #98a89c, borders #2c4234, away green #7fc08f, home amber #f0b429. Away team panels have green left edges; home panels have amber left edges. Halftime log markers and focus outlines use amber. **Why:** the user chose turf greens and chalk-white text, with green/amber separating the teams.

## Gotchas

- This is an experimental scenario model, not a calibrated or backtested forecasting service.
- Team Library data is database-backed but shared and unauthenticated, not private per-user accounts. Do not claim it is private or owner-protected.
- Simulation settings and saved runs remain browser-local. Clearing browser storage removes those, not saved team history.
- Kicker, OL, and defensive metrics can be recorded, but fantasy projections use the supplied offensive Half-PPR formula. IDP and kicker scoring are not defined.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
