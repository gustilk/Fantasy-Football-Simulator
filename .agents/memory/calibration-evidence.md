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