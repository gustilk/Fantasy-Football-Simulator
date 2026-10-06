# Do deep-pass matchups improve forecast accuracy?

**Result: not established.** The available library cannot support an eligible
held-out comparison of `secondary-v1` versus the unchanged `possession-v1`
baseline. This is not evidence that the new method helps or hurts.

Audited on **October 6, 2026**, using read-only development Team Library API
responses for 2025 and 2026. No team documents or saved forecasts were modified.
No weights, priors, ratings or simulation behavior were tuned.

## Actual sample coverage

| Evidence | 2026 | 2025 |
|---|---:|---:|
| Saved teams | 32 | 0 |
| Completed team-game rows | 128 | 0 |
| Distinct candidate games | 64 | 0 |
| Mirrored candidate games | 64 | 0 |
| Candidates with four saved prior games for both teams | 0 | 0 |
| Independently archived eligible input/roster pairs supplied | 0 | 0 |
| Complete observed DraftKings scoring ledgers in saved history | 0 | 0 |
| Eligible calibration games | 0 | 0 |
| Eligible held-out games | 0 | 0 |

The 2026 library contains weeks 1–4, so no candidate has four *earlier* saved
games for both teams. Shorter early-season windows are not automatically
disqualified by the evaluator; they still require valid independent pregame
evidence. Forty-eight candidates have recorded scores and some earlier history
for both teams; this does **not** make them leakage-free forecasts.

All 64 candidates are identified individually, with event IDs, prior-week
coverage, recorded scores, player-target completeness and exclusion reasons in
`reports/secondary-feasibility-2026.json`. The primary exclusion is missing
independently archived pregame roster/input evidence. Saved current availability
and depth roles cannot establish who was eligible before a historical kickoff.
The saved library also lacks the source-reviewed passing-play inventory needed
to substantiate its historical last-four evidence.

The 2026 read-only library response has SHA-256
`6f4d88a110874718cecbc9609e4932af2d2efa6b3027444b3196480f08db74f8`.
The 2025 response is an empty array, SHA-256
`4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.
These checksums bind the inspected bytes, **not** independent historical
authenticity. Recorded score fields are not promoted into source-reviewed
authoritative targets merely because they are present.

## Requested comparisons

| Endpoint | Empirical eligible coverage | Current finding |
|---|---|---|
| 10–19 air-yard attempts/completions and completion rate | 0 games | Secondary diagnostics unavailable; baseline does not generate air depth |
| 20+ air-yard attempts/completions and completion rate | 0 games | Secondary diagnostics unavailable; baseline does not generate air depth |
| Passing-only 15+ gain frequency | 0 games | Paired error difference unknown |
| YAC mean and >=5 / >=10 YAC frequency per measured completion | 0 games | Secondary diagnostics unavailable; baseline does not generate YAC |
| Team-score MAE/RMSE/bias and P10–P90 coverage | 0 games / 0 team targets | Paired error and coverage unknown |
| Classic fantasy MAE/RMSE/bias and P10–P90 coverage | 0 complete observed player targets | Paired error and coverage unknown |

Missing metrics remain `null`, not zero. No improvement percentage, team winner,
player score target or “80% coverage” claim is justified by this sample.

The baseline's absence of air-depth/YAC fields is an independent comparison
limitation: gain alone cannot identify air yards or YAC. Adding a decomposition
or random draws would change the baseline. The evaluator therefore retains
secondary-only component diagnostics separately from paired shared-endpoint
comparisons. Known-air and measured-YAC denominators remain visible, including
secondary interceptions for which no air distance was generated.

## Reproducible comparison now available

The read-only evaluator (`scripts/src/secondary-evaluation.ts`) accepts
independently archived, reviewed inputs, eligibility, last-four source plays and
authoritative final scoring targets. It:

1. Requires registration before kickoff and a locked model/evaluation fingerprint.
2. Keeps calibration and held-out games separate; the calibration period must
   precede evaluation. It never fits parameters or promotes calibration results
   into evaluation evidence.
3. Rebuilds recent offensive/defensive passing summaries from the latest four
   completed, pre-freeze games, handling byes and separately substantiating any
   prior-season support. Source identities, duplicate plays and chronology are
   checked; source inventory completeness/authenticity still require review.
4. Uses precisely the same full input and paired production seeds for both
   models, removing only the secondary version flag for the baseline.
5. Runs 200 outcomes per seed, retaining every play via a passive observer rather
   than parsing the three displayed highlights per drive.
6. Calculates team and complete observed Classic fantasy errors, game-balanced
   losses, descriptive game-bootstrap intervals and inclusive P10–P90 coverage.
   Bonuses are calculated per observed game. Missing/DNP/partial player ledgers
   are not imputed to zero; explicit observed zero/negative scorers remain valid.
7. Reports passing bands, gain and YAC endpoints with sample denominators,
   per-seed score means, and endpoint-specific exclusions.

The committed research manifest is intentionally **empty and UNREGISTERED**.
`reports/secondary-evaluation.json` is its actual output, not a synthetic
accuracy result. See `research/secondary-evaluation/README.md` for the source
contract and a new-study registration procedure.

## Verification, not empirical accuracy

The synthetic evaluator tests pass: paired production ensemble parity for both
models, unchanged output with/without the observer, deterministic replay,
pregame/last-four/source/roster gates, split separation, missing scoring fields,
explicit observed zeros, unknown baseline components, passing denominators and
null empty-study metrics. Synthetic fixtures are not real games.

The existing secondary regression suite passes, including the golden SHA-256
check that frozen possession-v1 output remains byte-for-byte unchanged.
`pnpm run typecheck` passes across the workspace.

A completion check also identified an existing save-schema mismatch for Michael
Wilson's supported 1.5 opportunity tier. The archive validator now accepts that
tier; a production forecast save/reload test preserves the tier, full frozen
input, summaries and older forecasts, while unsupported tiers still fail without
overwriting storage. This changes validation compatibility, not simulation weights.

## Decision

Keep `secondary-v1` labeled experimental and preserve all frozen forecasts.
Do not adjust behavior based on these tests or retrospective library-only
reconstructions. Collect independently timestamped pregame evidence under a
registered cohort, then evaluate separate held-out games once authoritative
final scores, passing plays and complete player ledgers are available.

Any later behavioral change must use a new model version and fresh evaluation
evidence. Repeated teams/weeks are dependent; Monte Carlo seeds are not extra
real observations, and descriptive bootstrap intervals are not a guarantee.
