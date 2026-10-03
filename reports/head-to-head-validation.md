# Head-to-head blend: validation feasibility

**Audited October 3, 2026. Verdict: insufficient saved history.**

There is no evidence here that the opponent-specific blend improves or worsens
predictions. No weights, division adjustments, scoring rules, saved teams, or
simulation behavior were changed. This is a feasibility audit, not a completed
forecast-accuracy backtest.

## Saved data inspected

A read-only query of the development database found only season **2026**, with
**32 teams**. A read-only `GET /api/season-teams?season=2026` supplied the saved
documents. Each team has exactly three played games: 30 teams have weeks 1–3;
Cleveland and Pittsburgh have weeks 2–4. This is **96 team-game rows** representing
**49 distinct games**, not 96 independent outcomes. Two games lack their opposing
team's matching saved row: Atlanta–Pittsburgh in week 1 and Jacksonville–Cleveland
in week 1. All 47 reciprocal pairs agree on venue, observed scores and source
event identifiers.

These are saved records labeled 2026, not independently reverified live results.
No ESPN requests, additional season imports, or database writes were performed.
The ESPN season-handling memory and `replit.md` were consulted. Correct-season
rosters, schedules and game summaries must each be checked separately if new
research data is obtained.

## Sample sizes

Each game is counted once. “Prior history” means at least one saved played game
strictly before the held-out week for **each** team. This is a minimal feasibility
screen, not an assertion that one training game is enough for calibration.

| Sample | Divisional | Non-divisional | Total |
|---|---:|---:|---:|
| Distinct saved games | 14 | 35 | 49 |
| Games with reciprocal saved rows | 14 | 33 | 47 |
| Held-out candidates with prior history on both sides | 9 | 22 | 31 |
| Candidates with complete reciprocal final scores | 9 | 22 | 31 |
| Candidates with at least three earlier games per team | 0 | 0 | 0 |
| Candidates with an earlier same-season opponent meeting | **0** | **0** | **0** |
| Held-out skill-player rows, player previously observed | 177 | 426 | 603 |
| Those rows with all Classic scoring fields observed | **0** | **0** | **0** |

The player count includes historical participants who are currently inactive.
It excludes absent/DNP rows and players not previously observed; those exclusions
are not zero-point observations. It does not count predictions or establish
historical eligibility.

## Requested error and calibration comparison

| Metric, baseline versus blend | Divisional | Non-divisional |
|---|---|---|
| Full player DK-point MAE / RMSE | Not estimable; 0 complete targets | Not estimable; 0 complete targets |
| Win-probability Brier score / reliability bins | Not run; 0 blend-exposed games | Not run; 0 blend-exposed games |
| Paired improvement estimate / confidence interval | Not identifiable | Not identifiable |

The baseline calls `setupFromHistory` without an opponent; the blend supplies the
opposing team's name. With no earlier meeting, the blend cannot change the
history inputs. Identical-seed comparisons would therefore be a no-op, not
evidence that the heuristic is calibrated. No simulation comparison was executed
on this insufficient sample, and no partial DK subtotal was passed off as a
complete fantasy-point target.

Non-divisional games are a useful control cohort, not an expected source of
same-season rematch treatment in a normal NFL regular-season schedule. An
overall average dominated by untreated games would dilute any eventual
divisional-rematch effect.

### Missing fields are unknown, not zero

`calculateDraftKings` calculates a subtotal of reported scoring events; it is
appropriate for the app's labeled partial totals, but not automatically a full
ground-truth score for validation. The complete-target audit requires observed
passing yards/TDs/interceptions, rushing yards/TDs, receptions/receiving yards/TDs,
lost fumbles, kick/punt/field-goal return TDs, two-point conversions, and offensive
fumble-recovery TDs. Yardage bonuses follow from observed yards.

All 603 eligible player rows omit two-point conversions, field-goal return TDs
and offensive fumble-recovery TDs. Lost fumbles are missing in 540 rows
(155 divisional, 385 non-divisional). Position alone does not prove a missing
scoring field is zero. Explicit reported zeros remain valid observations.
Future field-matched DK-component errors can be reported separately, but must
be labeled as partial, with field coverage; they cannot be called full DK error.

### Roster and availability look-ahead

The production history builder filters the saved roster's **current** active
flags, even though its stat cutoff correctly excludes the held-out/future
weeks. The saved documents do not supply week-by-week pregame roster,
position/team assignment, injury or inactive snapshots. Current source check
timestamps do not prove historical availability.

Consequently, using that roster directly for historical predictions would select
players using information learned after the forecast date. Selecting inputs from
the held-out box score would also leak participation. The audit only counts
previously observed player IDs and historical target rows; it never interprets
those counts as an unbiased forecast sample.

For an operational backtest, use timestamped pregame roster/availability evidence
and identical eligible rosters in both arms. If that evidence cannot be obtained,
a separately labeled prior-participation cohort may be informative, but its
survivorship, position-change and availability biases must remain explicit.
Absent held-out rows must remain DNP/unknown, not invented zero-point targets.

## Protocol when adequate independent research data exists

1. Keep any research corpus separate from the user's latest-three-games library.
   Verify requested season on every roster, schedule and game response; reject
   mismatches rather than substituting a season.
2. Sort held-out games by week. For week W, train both teams only on played
   games with week < W, with team identity/position/availability known before
   kickoff. Do not use held-out scores, targets or current active flags as inputs.
   Keep weather neutral unless historical pregame weather is independently known.
3. Build identical inputs, differing only in the opponent parameter to
   `setupFromHistory`. Fix and record a deterministic per-game base seed, regular
   importance and 200 ensemble runs. Use the exact same seeds in both arms:
   `(baseSeed + Math.imul(i, 2654435761)) >>> 0`, as in `ensemble.ts`.
   Matching seeds pair starting random streams; changed branches can consume
   them differently, so this is not guaranteed identical play-level randomness.
4. Score each simulated game's raw stats with Classic scoring before averaging
   ensemble points (not the DK score of average yards). Match players by stable
   identity, not names or changing row order. Assess only targets with verified
   complete scoring coverage; separately report unknown/DNP/new-player exclusions.
5. Report player-game MAE and RMSE, and paired blend-minus-baseline errors.
   For win calibration use the home/away/tie probability vector and a one-hot
   final result: multiclass Brier score is the sum of three squared errors.
   Report home-win reliability bins with counts, mean predicted probability and
   observed win frequency; ties are a separate class, not half-wins.
6. Break out divisional/non-divisional and blend-exposed/control games. Report
   game counts, player counts, roster exclusions and scoring-field coverage.
   Use paired uncertainty estimates clustered by game, noting repeated teams
   and season dependence. Sparse bins or rematches cannot justify a confident
   weight change. Keep any later tuning separate from final held-out evaluation.

## Reproduce the read-only audit

From the workspace root:

```sh
curl -fsS "https://${REPLIT_DEV_DOMAIN}/api/season-teams?season=2026" \
  -o /tmp/h2h-season-2026.json
pnpm --filter @workspace/scripts exec tsx src/h2h-history-audit.ts \
  /tmp/h2h-season-2026.json 2026
pnpm --filter @workspace/scripts exec tsx src/h2h-history-audit.test.ts
```

The audit uses the generated API validator, rejects mixed seasons and duplicate
team/week/player identities, verifies reciprocal games, counts strict
prior-week evidence, and leaves unavailable metrics as `null`. Saved data may
change, so later runs can legitimately return different counts.

Verification: `pnpm run typecheck`, the audit regressions,
`scripts/division-matchup-test.ts`, and `scripts/draftkings-test.ts` passed.
The app preview loaded without browser errors. A full end-to-end browser test
was unnecessary because no user flow was changed.