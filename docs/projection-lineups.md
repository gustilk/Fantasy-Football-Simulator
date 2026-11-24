# My Picks: "Generate 150 from projections"

A new button in My Picks (section 4). The existing random generator is unchanged.

## What it does
1. Takes your selected players (options, not locks).
2. Matches each to a saved pregame projection. Sunday games come from the DraftKings tab; Thursday/Monday games come from Game Simulator runs. If a game was saved in both, the newest save is used. Players with no usable projection (or excluded as OUT/IR/Doubtful) are skipped and listed.
3. Replays the frozen forecasts into 1,500 joint outcomes (same-game players share one simulated game) plus a second, independent set for reporting.
4. For 700 of those outcomes, searches for a high-scoring legal lineup (multi-start local search with single swaps and QB + pass-catcher swaps). Stacks appear where the simulations reward them.
5. Scores each distinct candidate on the independent outcomes and picks the portfolio by 90th-percentile upside, with a per-player exposure limit (default 60%) and an overlap limit (max 7 shared players, relaxed to 8 only if needed).
6. Export CSV uses the same DraftKings ID format as the other lineup exports.

## Limits (honest)
- The per-outcome search is a heuristic, not a proven optimum. On a 72-player test pool it landed within about 0.5 points of the exact optimum.
- Projections are estimates. Nothing here guarantees winnings; it does not model opponents' lineups, ownership or payout structure.
- Fewer than 150 lineups are returned (with a note) when the pool or limits cannot produce 150 distinct lineups.
- A position with few selected candidates (for example one QB) must exceed the exposure limit; this is reported.
- Not a full portfolio/contest-simulation optimizer; that remains out of scope.

Tests: `scripts/src/projection-lineups.test.ts`.
