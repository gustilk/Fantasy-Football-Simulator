# Secondary matchup accuracy study

Read-only research, separate from Team Library and browser forecasts. The
committed manifest is **empty and unregistered**: it is not an empirical sample.
Synthetic tests prove replay and gates, never predictive improvement.

## Registration and execution

Before collecting a new cohort, retain an independently timestamped registration
with the season/week range, every scheduled candidate game, exclusion policy,
capture horizon, fixed ordered seeds, endpoints, and calibration/evaluation
cutoffs. Use a **new directory** for a new study. Calibration must precede the
held-out period. Never move an unfavorable evaluation game to calibration or
update a fingerprint to conceal tuning. This runner does not fit parameters.

```sh
pnpm --filter @workspace/scripts exec tsx -e \
  'import { secondaryFingerprint } from "./src/secondary-evaluation.ts"; console.log(secondaryFingerprint())'
pnpm --filter @workspace/scripts exec tsx src/secondary-evaluation.ts \
  ../research/secondary-evaluation/manifest.json
pnpm --filter @workspace/scripts exec tsx src/secondary-evaluation.test.ts
```

Manifest: `version: 1`, `modelRevision` (the fingerprint), `registeredAt`
(timezone-qualified independent registration timestamp), `seeds` (1–20 unique
nonzero uint32s), `games`. Each candidate game is registered once:

```json
{
  "id": "2026_06_GB_DET",
  "split": "held-out",
  "kickoff": "2026-10-18T17:00:00Z",
  "sourceReview": "approved",
  "input": {"path": "archives/input.json", "sha256": "<64 lowercase hex>"},
  "eligibility": {"path": "archives/eligibility.json", "sha256": "<64 lowercase hex>"},
  "outcome": {"path": "archives/outcome.json", "sha256": "<64 lowercase hex>"}
}
```

This is a schema illustration, **not a real scheduled game**. Use consistent
nflverse game IDs, with an independently reviewed join to the official event,
kickoff (including postponements), teams and scoring sources. `sourceReview:
"approved"` is a manual audit declaration, not automated authentication.

## Archive contract

Reuse the hashed, path-contained archive envelopes and full roster/scoring
requirements in [the market-study contract](../market-evaluation/README.md).
No quote/market archive is required or allowed in this comparison. All envelopes
carry `gameId`, `kind` (`input`, `eligibility`, `outcome`), `capturedAt`, HTTPS
`sourceUrl`, HTTPS `archiveUrl`, and `payload`.

Retain unmodified source payloads/pages, hashes and reviewed derivations, plus
independently timestamped receipts. Current roster flags, current depth charts,
eventual participation, manual backdated timestamps and local checksums alone
cannot establish pregame eligibility. The input must itself have been frozen
pregame; this runner does not claim to authenticate retrospective reconstruction.
Human source review must confirm **all** ratings, weather, strength, usage,
depth, availability, recent stats, strategy, standings, prior support and other
non-secondary fields are point-in-time as well.

### Input additions

`payload.input` is the exact full `SimulationInput`, without `market` or `seed`,
with `driveModel: "possession-v1"` and `secondaryModel: "secondary-v1"`.
Explicit both-team QB/RB/WR/TE rosters must exactly match the eligibility archive.
The baseline differs **only** by removing `secondaryModel`. Ratings, evidence,
player opportunity, weather and every other setting stay fixed.

`historyThrough` cannot exceed capture time. `secondaryHistory` contains exactly
one entry for each team:

- `team`, `season`, `matchupWeek`, `complete: true` (reviewed complete schedule
  inventory of all completed pre-freeze regular-season games).
- `completedGames`: `{id, week, completedAt, offensePlays, defensePlays}`.
  Dates are completed-game timestamps, not import times. Inventories are ordered
  chronologically by week; byes are not games. Include earlier games even when
  only the latest four contribute. Shorter season-start windows are accepted
  and disclosed, not manufactured into four games.
- Each play is a retained nflverse string/NA row with `season`, `season_type`,
  `week`, `game_id`, `play_id`, `posteam`, `defteam`, `play_type`, `pass_attempt`,
  `sack`, `rush_attempt`, `qb_scramble`, `complete_pass`, `air_yards`,
  `yards_gained`, `yards_after_catch`, `epa`, and relevant exclusion flags.
  Do not use sacks/scrambles/spikes/kneels/deleted or two-point plays as throws.
- If prior support is present, include a separate `prior` object with
  `season: currentSeason - 1`, `complete: true`, `offensePlays`, `defensePlays`.
  Never relabel it as current-window evidence. The existing model caps still apply.

The runner rebuilds current offensive/defensive passing reports from the
latest four completed games, checks their exact fields and weeks against the
frozen evidence, and separately rebuilds supplied prior reports. It does not
infer whether an omitted game should have been in a schedule; independent
inventory completeness review is required.

### Outcome additions

`payload` includes `final: true`, exact `awayTeam`/`homeTeam`, nonnegative integer
`awayScore`/`homeScore`, optional `players` (complete observed ledgers under the
linked contract), and optional `passing` keyed by exact team name.

Each passing target is `{complete: true, plays: [...]}` using the same raw row
contract, only from that held-out game. `complete: true` means reviewed full
throw inventory, not that unknown depth/YAC values have become known. Missing
passing ledgers exclude that endpoint, not an otherwise valid final score.
Missing/partial player ledgers exclude that player target, not impute zero.
Unmatched observed players are reported, never added to the pregame roster.

## Endpoints and interpretation

- Team scoring: paired game-balanced MAE/RMSE/bias and inclusive P10–P90 coverage.
- Classic fantasy: same metrics using explicit complete observed DK ledgers,
  bonuses calculated per game; include observed zero/negative scores.
- Throws: attempts/completions, 10–19 and 20+ air-yard attempts/completions and
  completion rates, passing-only 15+ gain frequency, YAC mean and >=5 / >=10 YAC
  frequencies per measured completion. Full-count targets with missing depth
  are unknown. Full-game gain/YAC rates require complete relevant field coverage.
  Known-depth completion rates retain their disclosed measured denominator.

Production possession-v1 does **not** generate air depth/YAC. Its missing
baseline metrics remain null; secondary diagnostics for those endpoints do
not establish paired improvement. Secondary interceptions may lack air depth:
predicted band counts cover known-air throws and disclose `depthKnown` versus
all attempts. No proxy based on gain or extra RNG calls are added to the baseline.

Each seed uses the production schedule of 200 games; the pass observer receives
detached frozen copies of **all** plays, not the truncated display highlights.
The pooled distribution is used for uncertainty intervals. Raw simulated
denominators and per-seed team means expose coverage and Monte Carlo variation.
Seeds are not real games. Game-level descriptive paired bootstrap intervals
do not remove dependence between repeated teams/weeks or source-selection bias.
Uncertainty coverage is not promised to be 80%.

The report separates calibration from held-out summaries, reports all primary
game exclusions and endpoint-specific missingness, and keeps empty metrics null.
Negative secondary-minus-baseline loss favors secondary on the eligible sample;
no result automatically recommends model tuning. Any later behavior change
requires a new version and fresh held-out evidence; preserve archived inputs.
