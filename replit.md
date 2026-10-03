# Gridiron Sim

A saved NFL season library and fantasy matchup lab: full rosters, raw weekly player/team statistics, and history-based DraftKings NFL Classic simulations.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the managed API server
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `PORT=8080 BASE_PATH=/ pnpm --filter @workspace/gridiron-sim run build` — standalone frontend build check; managed artifact workflows supply these routing variables automatically.
- The simulator runs in the browser. Optional roster/stat imports use ESPN public site data and need no user API keys.

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
- ESPN imports fetch rosters and each team's last three completed regular-season games for the selected season. They never silently substitute another season. Preview → apply to draft → Save team is explicit; default merge preserves entered values. Updating roster activity/details and replacing existing game values are separate opt-ins. Source links and checked timestamps persist inside the roster/week documents. The public endpoint is not a guaranteed live feed; data is cached for five minutes and missing fields stay unknown.
- Fantasy points now use DraftKings NFL Classic offense scoring: full PPR, passing/rushing/receiving yardage bonuses, and -1 for interceptions thrown and lost fumbles. Bonuses are scored separately for each game before ensemble averaging. Partial imported totals reflect recorded stats only; unreported scoring plays remain unknown. Classic has no individual-defender or kicker slots, so those players show no individual DK points.

## Product

- Two sections: Team Library and Game Simulator.
- All 32 teams, separate seasons, full offense/defense rosters, individual and bulk roster entry.
- 18 weekly slots for 17 regular-season games plus a bye; player game totals, custom numeric metrics, and team defense totals.
- Saved-history mode includes all active QB/RB/WR/TE players, with the most-used QB starting, rather than a fixed six-player roster.
- Records are derived from entered earlier results. Weather, home field, and game importance make small, bounded heuristic adjustments.
- Team division labels use current NFL alignment. Same-division matchups are flagged automatically in the library, setup and results, but division membership itself never applies a difficulty or fantasy-point penalty. The user wants divisional familiarity considered without assuming every such game is low-scoring.
- Saved-history simulations can blend earlier same-season games against the selected opponent into known player and team-defense fields: 5% weight per observed field per meeting, at most 15%, with the change capped at 20% of the baseline average (minimum numeric cap 0.2). Unknown/DNP fields are not filled. Metadata shows sample size and maximum weight; no evidence means no extra adjustment. This is an uncalibrated heuristic and can raise or lower inputs. Only played games strictly before the matchup week qualify; saved input snapshots retain their original opponent-specific evidence.
- Every new run summarizes 200 games with mean DK points and 10th–90th percentile model outcomes; score and drive log are one illustrative run. Example-game DK points match the displayed raw stats and are separate from ensemble averages. Older saved runs retain their data but cannot display old Half-PPR means as DK averages.
- Settings and up to 10 runs persist in this browser; reopening a new saved run restores its input setup.

## User preferences

The user wants the simulator to know teams' top players: WR1 is the primary/best receiver, with WR2/WR3 below it; the same principle applies to RB and TE. Explicit depth roles must guide workload rather than ranking players solely by recent box-score volume. Injury availability is separate from role; missing injury-game rows must not demote a returning starter or become zero performances.

Depth roles load read-only from season-validated current ESPN charts for selected teams; saved manual ranks override automatic roles. The roster editor exposes ranks, and source refreshes preserve manual choices. Source-listed rank is a workload prior, not a validated talent score or guaranteed fantasy-point floor. The inputs and results retain rank labels, and saved input snapshots retain their roles and source timestamp. Live charts describe current roles, not historical pregame availability; do not use them for retrospective backtests without appropriate as-of records.

**Why:** short recent histories may cover an injury absence or temporary replacement stint. Primary roles should not be assigned just by who accumulated the most recent targets/carries. Deep-backup workload priors are smaller, and old usage is bounded relative to the current role.

The user wants two sections: enter and save all offensive and defensive players and their weekly stats for each team, then automatically reuse those stats when simulating matchups.

For internet-sourced 2026 data, the user wants players' team assignments and offensive/defensive statistics from the last three completed games, not a full-season dataset.

The user wants DraftKings-style readable player stats, DraftKings fantasy points calculated from the stats, and no non-participants in game-stat displays. Keep the full roster available for management; game tables use recorded participation, not current activity or positive points. Zero/negative scorers and inactive historical participants still appear.

The app's palette is background #0f1a13, cards #16251b, text #e9e8de, muted text #98a89c, borders #2c4234, away green #7fc08f, home amber #f0b429. Away team panels have green left edges; home panels have amber left edges. Halftime log markers and focus outlines use amber. **Why:** the user chose turf greens and chalk-white text, with green/amber separating the teams.

## Gotchas

- This is an experimental scenario model, not a calibrated or backtested forecasting service.
- Team Library data is database-backed but shared and unauthenticated, not private per-user accounts. Do not claim it is private or owner-protected.
- Simulation settings and saved runs remain browser-local. Clearing browser storage removes those, not saved team history.
- Kicker, OL, and defensive metrics can be recorded, but fantasy projections use DraftKings NFL Classic offense scoring. Do not invent IDP/kicker points or derive DST points allowed from the opponent's final score (offensive turnover scores are excluded by DK).

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
