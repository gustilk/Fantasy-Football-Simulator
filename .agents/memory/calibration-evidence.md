---
name: Calibration evidence
description: Point-in-time eligibility and missing-scoring safeguards for prediction evaluation.
---

Keep calibration research data separate from the user's recent-game library. Do not substitute current active flags or held-out participation for historical pregame eligibility.

**Why:** The user requested leakage-free held-out evaluation without overwriting team data; a correctly cut-off stat history alone does not establish who was eligible before kickoff.

**How to apply:** Require independent pregame roster/availability evidence for operational accuracy claims. Label prior-participation cohort analyses as limited, and never impute DNP or unreported scoring events to zero.

Do not claim an opponent-specific effect from held-out games with no earlier same-season meeting.

**Why:** Untreated games cannot identify the blend's predictive contribution, even if paired seeds produce identical results.

**How to apply:** Report blend-exposed rematches separately from divisional/non-divisional controls before drawing conclusions or tuning weights.

Public odds retrieval times are not sportsbook publication times. Manual timestamps are declarations, not independently verified pregame evidence.

**Why:** ESPN supplies useful spread/total quotes but the inspected schedule feed does not establish when the sportsbook published each line. Recording when the app fetched it must not be presented as a verified closing line.

**How to apply:** Use retrieval timestamps for freshness warnings and reject known post-kickoff observations. For accuracy evaluation, require an archived pregame quote and independently captured eligibility; do not treat a current quote as historical evidence.

nflverse's historical spread sign is the opposite of the app's home-spread input convention.

**Why:** The inspected nflreadr schedule dictionary defines a positive spread as home favored; the app uses a negative home spread for home favored. Copying the raw value would reverse the implied favorite.

**How to apply:** In a future nflverse adapter or evaluation join, normalize with `homeSpread = -spread_line`, verify home/away orientation, and test both favorite directions before comparing predictions.

Local checksums and archive URLs establish consistency, not independent historical authenticity.

**Why:** A perfectly hashed JSON file can still contain backdated declarations. Offline evaluation cannot verify when the original source actually became available.

**How to apply:** Require source/receipt review before making accuracy claims. When independently frozen pregame inputs are unavailable, use prospective collection rather than backdating a retrospective reconstruction.

Keep simulated DraftKings projections separate from observed player-performance history. Do not feed saved forecasts back into the simulator as real results.

**Why:** The app is intended to support future DraftKings choices. Treating its own predictions as outcomes would reinforce model mistakes, while weighting both recorded stats and the DK totals derived from them can double-count the same evidence.

**How to apply:** Archive forecasts for later comparisons. Use actual recorded stat history for simulation inputs; clearly distinguish complete official point entries, partial stat-derived subtotals, and unknown outcomes. Any new direct fantasy-score weighting needs a separate justified evaluation.

A batch's start time alone does not establish that its forecasts were saved before kickoff. Do not retrofit older forecasts with invented completion times.

**Why:** A Sunday batch can start before kickoff and finish afterward; accepting its start time would admit late forecasts into accuracy summaries.

**How to apply:** Preserve older archives, but exclude insufficiently timed forecasts from strict pregame summaries. Use one whole-game snapshot per game, chosen by the latest eligible pregame save, to avoid overweighting repeated runs or selectively reviving players omitted from the final roster.
