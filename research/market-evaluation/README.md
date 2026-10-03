# Isolated pregame market evaluation data

This directory is research-only. Do not copy its files into Team Library, write
the team database, or import the user's saved team documents as historical
eligibility evidence. No real eligible archived observations are currently
supplied; `manifest.json` is intentionally empty.

## Registration

Before prospective collection, choose the cohort, capture horizon, paired seeds,
and endpoints described in `reports/market-odds-validation.md`. Compute the
current model fingerprint with:

```sh
pnpm --filter @workspace/scripts exec tsx -e \
  'import { modelFingerprint } from "./src/market-evaluation.ts"; console.log(modelFingerprint())'
```

Replace `UNREGISTERED` in a **new study directory's** manifest with that digest.
Set `registeredAt` to the independently recorded study registration time. Preserve
the registration externally; a local manifest timestamp alone is not proof.
The runner refuses nonempty studies whose model fingerprint has changed or whose
registration is not before a game's kickoff. Never update the fingerprint to
hide tuning on the holdout. The committed empty manifest is not empirical data.

Each manifest has `version: 1`, `modelRevision`, `registeredAt`, a nonempty list of
unique nonzero uint32 `seeds`, and `games`. Freeze the ordered seeds for the study.
Each game record has:

```json
{
  "id": "stable-official-event-id",
  "split": "held-out",
  "kickoff": "2026-11-01T18:00:00Z",
  "input": {"path": "archives/event-input.json", "sha256": "<64 lowercase hex>"},
  "eligibility": {"path": "archives/event-eligibility.json", "sha256": "<64 lowercase hex>"},
  "quote": {"path": "archives/event-quote.json", "sha256": "<64 lowercase hex>"},
  "outcome": {"path": "archives/event-outcome.json", "sha256": "<64 lowercase hex>"}
}
```

These are schema illustrations, not game evidence. Set `quote: null` when the
pregame line is missing. Other splits are explicitly excluded. Use the actual
kickoff (including postponements), validated against an independently retained
schedule source. Include every preregistered game even if evidence is missing.
Each file reference is relative to the manifest's research directory, cannot
escape it via traversal or symlinks, and binds the full file bytes via SHA-256.

## Archive envelope

Every referenced archive is a JSON object:

```json
{
  "gameId": "stable-official-event-id",
  "kind": "quote",
  "capturedAt": "2026-11-01T17:00:00Z",
  "sourceUrl": "https://source.example/original-event-data",
  "archiveUrl": "https://independent-archive.example/pregame-receipt",
  "payload": {}
}
```

Both URLs must use HTTPS. All timestamps must include a timezone. Capture time
must be substantiated by the linked archive, not backdated to a claimed source
publication time. Preserve the original unmodified raw payload/page alongside
each normalized archive and a reviewed derivation record. Hash those retained
sources too. A third-party archive, independently timestamped storage receipt,
or separately audited pregame collector is required. Neither a manual declaration
nor a current ESPN response proves historical chronology. The runner checks
local chronology/identity/checksums; manual source review remains necessary.

Archive kinds and payloads:

### `input`

- `historyThrough`: latest observation timestamp used to derive any input,
  not later than `capturedAt`.
- `input`: exact `SimulationInput` without `market` or `seed`; includes `away`,
  `home`, `weather`, optional `importance`. Both team setups must have explicit
  `roster` arrays of `{id, name, position, ...}` with unique IDs and
  QB/RB/WR/TE positions, and the simulator's ratings/slot labels/context.
  Retain excluded roster members and reasons in the raw eligibility evidence.
  The included roster must exactly match eligible players below.

The input archive must itself be captured before kickoff. This runner deliberately
does not backdate retrospectively constructed inputs. For a retrospective study,
obtain actual independently frozen pregame forecasts or design a separate audited
reconstruction workflow rather than misrepresenting a later file as pregame.

### `eligibility`

- `complete: true` only after independent evidence for **both teams** is reviewed.
- `players`: all included eligible skill players, each with
  `{playerId, team, name, position}`. Stable `playerId` must match input roster ID.
  Team/name/position must also match. Selection must not use eventual
  participation or today's roster/depth/Active status.

Captured no later than the input freeze, strictly before kickoff. If availability
or role is unknown, follow the preregistered exclusion rule; do not fabricate
healthy status or a missed-game probability.

### `quote`

- `awayTeam`, `homeTeam`: exact team identities in the frozen input.
- `homeSpread`: negative means home favored, in points.
- `total`: game over/under in points.
- `provider`: specific book/line source chosen in registration.
- Optional genuine `publishedAt` or raw receipt metadata may be retained,
  but do not derive it from retrieval time. The runner uses independent
  `capturedAt` for chronology, not a claimed book publication time.

Captured no later than input freeze and strictly before kickoff. Both numbers
must pass the existing production odds limits. No historical closing-line claim
is made. The report exposes quote age so stale quotes remain visible.

### `outcome`

- `final: true`, nonnegative integer `awayScore` and `homeScore`.
- Optional `players`: observed player-game targets with
  `{playerId, observed: true, stats: {...}}`.
- `stats` must explicitly contain **all** scoring fields:
  `passYards`, `passTD`, `interceptions`, `rushYards`, `rushTD`, `receptions`,
  `receivingYards`, `receivingTD`, `fumblesLost`, `kickReturnTD`, `puntReturnTD`,
  `fieldGoalReturnTD`, `twoPointConversions`, `offensiveFumbleRecoveryTD`.
  Event counts are nonnegative integers; yardage may be negative.

Capture post-kickoff from an authoritative final scoring source. Include final
status/raw scoring evidence; `observed: true` is an audited declaration, not an
inference from eligibility, absence, or a blank box score. Omitted/partial player
targets remain unknown. Explicit fully observed zero ledgers may be evaluated.
Fantasy bonuses are calculated per observed game, then compared against mean
per-game simulated DK, never bonuses calculated on averaged yardage.

## Execute and interpret

```sh
pnpm --filter @workspace/scripts exec tsx src/market-evaluation.ts \
  ../research/market-evaluation/manifest.json
pnpm --filter @workspace/scripts exec tsx src/market-evaluation.test.ts
```

The JSON report distinguishes all-eligible baselines from quoted same-game paired
baselines. Negative weighted-minus-baseline losses favor market weighting.
Metrics remain `null` for empty cohorts. ESS is per seed out of 200 outcomes,
not a count of real games. Missing quotes are counted over all supplied games;
rejected quote count covers only games whose other required evidence passes.
Games excluded before quote checks retain their primary exclusion reason.
Player-target counts cover only paired games; they do not represent all NFL
players or targets in baseline-only/excluded games.

Per-game player coverage/exclusions and unmatched outcome player IDs are retained.
Do not select or expand the pregame roster based on those observed outcomes.
Reliability-bin sample sizes and repeated-team/week dependence matter. No
automatic result ever says an improvement is established or tunes the blend.