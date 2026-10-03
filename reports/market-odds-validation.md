# Market weighting: evidence and evaluation

**Assessment date: October 3, 2026. Verdict: insufficient historical evidence.**

No measured accuracy gain has been established. The experimental market blend
remains **35%**, with **200 generated games** per seed. No model weights, scoring
rules, saved teams, or Team Library records were changed.

## Evidence available

The project contains public-feed odds retrieval and manual odds entry, but no
independently archived historical pregame quote/roster/availability corpus. The
committed research manifest therefore has **zero games**. The existing
`reports/head-to-head-validation.md` audits saved history, but does not establish
pregame odds or historical eligibility; those saved records were not repurposed.

An ESPN retrieval timestamp does not establish when a sportsbook published a
line. A field named “close” does not prove a historical closing quote. Current
depth charts, current Active flags, manual timestamps, and eventual participation
cannot substitute for pregame roster/availability evidence. No retrospective
ESPN fetch, Team Library import, database write, or external paid feed was used.

| Requested comparison | Original model | Market weighted | Interpretation |
|---|---:|---:|---|
| Independent held-out paired games | 0 | 0 | No accuracy comparison possible |
| Score-total MAE / RMSE | Not measurable | Not measurable | No eligible evaluation observations |
| Home-minus-away margin MAE / RMSE | Not measurable | Not measurable | No eligible evaluation observations |
| Home-win Brier / reliability bins | Not measurable | Not measurable | No calibrated win-probability claim |
| Away/home/tie multiclass Brier | Not measurable | Not measurable | Ties are not silently dropped |
| Complete observed player-game DK error | Not measurable | Not measurable | Eligibility and full scoring targets required |
| Effective sample size (ESS) | 200 per seed by construction | Not measurable empirically | Synthetic tests are not evidence of gain |

Missing quotes: **0 among 0 supplied research games**, not a statement that all
historical NFL games have quotes. Excluded games: **0 among 0 supplied games**.
Baseline-only eligible games: **0**. The empty report emits `null` metrics rather
than invented zeros. Player targets are also absent. These denominators matter:
there is no independently evidenced historical candidate population to count.

## Delivered evaluation runner

Run from the workspace root:

```sh
pnpm --filter @workspace/scripts exec tsx src/market-evaluation.ts \
  ../research/market-evaluation/manifest.json
```

The runner prints a JSON report and only reads local research files. To save a
report separately from team data:

```sh
pnpm --filter @workspace/scripts exec tsx src/market-evaluation.ts \
  ../research/market-evaluation/manifest.json \
  > research/market-evaluation/results.json
```

The empty manifest is an honest collection starting point, **not a completed
registration**. Follow `research/market-evaluation/README.md` to freeze the model,
seeds, cohort, and provenance before adding prospective games.

For each eligible held-out game, the runner uses exactly the same frozen pregame
inputs and production seed schedule in both modes. It generates 200 games once
per seed, then applies uniform baseline weights or the production market
reweighting to those **same** complete outcomes. Scores and player events are
never edited after simulation. Forecast total and margin come from ensemble
means, **not** the one illustrative game shown in the app. Seed replicates are
averaged per game and do not inflate the independent game count.

The report includes:

- Baseline error on **all** eligible games, including games with missing/rejected
  quotes; a separate **same-game paired baseline** for fair market comparisons.
- Total/margin MAE and RMSE, binary home-win Brier, multiclass away/home/tie Brier,
  and ten fixed home-win reliability bins with counts and empty-bin `null`s.
- Weighted-minus-baseline game-level error differences (negative is better);
  deterministic descriptive paired bootstrap intervals, `null` for one game.
  Squared-error differences are reported as squared losses, not mislabeled RMSE
  differences. Aggregate RMSE values are available separately.
- Per-game/seed ESS `1 / sum(weight²)`, minimum ESS fraction, maximum outcome
  weight, baseline ESS/weight, and out-of-generated-range warnings. Lower ESS
  describes concentration, not improved calibration or more evidence.
- Every excluded game and reason, missing/rejected quote counts, baseline-only
  counts, quote age at input freeze, and independently complete DK player target
  denominators. Unmatched postgame players are listed, never used to select inputs.
- Player-game DK MAE/RMSE for eligible players with complete observed scoring
  ledgers only, plus a game-balanced MAE difference to limit target-count bias.
  Missing/DNP/unknown rows are excluded, not imputed as zero. A documented
  complete zero ledger can qualify; zero alone does not establish participation.

Checksums establish byte identity, **not authenticity**. A URL and timestamp in
JSON are not independent proof either. Before using any results externally, a
reviewer must inspect the original archived content, confirm its actual pregame
capture and event/team/player identity, and verify the declared input freeze and
scoring completeness. The runner enforces chronology and internal consistency,
but cannot authenticate third-party archives offline.

## Prospective study design (required next, not a measured result)

1. **Preregister and lock.** Before the first included kickoff, publish the model
   fingerprint, fixed 35% blend, 200 outcomes, paired seeds, eligible game cohort,
   exclusion rules, and primary endpoint (game-level total MAE difference).
   Treat margin MAE, Brier/reliability, and player DK as secondary endpoints.
   Lock every scheduled game before observing results. Do not select only games
   with favorable model/line disagreement.
2. **Capture pregame evidence independently.** At a fixed horizon (e.g. 60 minutes
   before kickoff), archive a spread/total from one named book, with home-spread
   sign and both team identities. Preserve source payload, independent archive
   receipt, capture time, and any genuine book publication time as distinct
   fields. Never relabel ESPN `fetchedAt` as publication/closing time.
   Independently archive official roster, depth and game-day availability
   reports. Unknown eligibility is a declared exclusion, not a healthy flag.
3. **Freeze all other inputs.** Use only statistics observed before the freeze;
   retain raw sources and derivation, weather, ratings, usage, depth, availability,
   and exact model input. Archive the frozen input itself before kickoff. No
   late availability changes or final-game information may enter either mode.
   Link every included player by stable ID, team, name and position to the
   eligibility snapshot. Missing evidence on either team excludes the game.
4. **Record outcomes afterward.** Save authoritative final scores and a complete
   scoring-event ledger for each eligible DK skill player where available,
   including bonuses, lost fumbles, return TDs, two-point plays and offensive
   recovery TDs. Explicit zeros must be source-established; a partial ESPN
   subtotal is not a full DK target. Retain missing and incomplete cases.
5. **Analyze once on holdout.** Keep historical/development data separate. Run
   both modes on paired seeds without tuning. Examine baseline-only and paired
   coverage, quote age, exclusions, ESS, reliability-bin counts, and sensitivity
   to weeks/teams. Game-bootstrap intervals provided by the runner are descriptive:
   repeated teams/weeks can make them too narrow. Use prespecified week/season
   blocks for confirmatory uncertainty; never bootstrap players or generated
   outcomes as independent observations.
6. **Use sufficient evidence.** Determine a minimum game count and meaningful
   effect threshold in a power analysis on a separate pilot/development cohort.
   A nominal target such as 100 games is **not** itself proof of adequate power
   and likely leaves probability bins sparse. Collect at least multiple weeks,
   extend across seasons if necessary, and report statistical and practical
   uncertainty. Establish a gain only if the prespecified primary effect and
   uncertainty criteria are met with acceptable coverage and no leakage.
7. **Keep tuning separate.** Any change to 35%, bandwidth, quote selection,
   eligibility rules, or other model settings must use a separate development
   set and a newly untouched evaluation cohort. Do not repeatedly inspect the
   holdout and tune to it.

## Verification

Synthetic regression fixtures verify paired production parity, reproducibility,
hash/timestamp/roster gates, missing quote baseline preservation, complete DK
targets, negative yardage, exclusions, ties and metric arithmetic. They are
explicitly labeled fabricated and are deleted after tests. They provide
implementation confidence only, not predictive-accuracy evidence.