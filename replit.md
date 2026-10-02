# Gridiron Sim

A repeatable NFL fantasy matchup lab with editable lineups, weather, recent offensive and defensive averages, drive logs, and Half-PPR outcomes.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
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

## Architecture decisions

- Recent statistics are entered as per-game averages, preferably over the last 3–5 games, and blended with baseline probabilities rather than treated as future box scores. **Why:** a small historical sample should inform the model without eliminating simulation variance.
- Free-text injury/context notes are displayed but not automatically interpreted. **Why:** heuristic text parsing could silently misread availability; the user should adjust ratings explicitly.
- No live NFL roster or injury feed is claimed. Example player labels must be updated by the user.
- Half-PPR follows the user's exact supplied formula, which does not specify interception or fumble deductions. Kicking points are outside that formula.

## Product

- All 32 NFL team choices; editable QB, RB, WR1, WR2, WR3, TE, and kicker labels.
- Optional recent offensive player averages and defensive averages allowed to opponents.
- Fresh seeded runs, compact drive highlights, player stat/fantasy tables.
- Settings and up to 10 runs persist in this browser; reopening a new saved run restores its input setup.

## User preferences

The user wants a reusable simulator they can rerun at any time, with optional previous-game statistics informing fantasy-point estimates.

## Gotchas

- This is an experimental scenario model, not a calibrated or backtested forecasting service.
- Data is browser-local, not synchronized between devices. Clearing browser storage removes saved setups and runs.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
