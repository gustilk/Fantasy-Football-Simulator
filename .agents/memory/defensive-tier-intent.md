---
name: Defensive tier semantics and snapshot compatibility
description: How defensive bonuses combine, and why old forecast inputs must stay neutral.
---

Defensive team and player tags are role-weighted event/opportunity tendencies, not DraftKings point multipliers. Add the independent team and player bonuses instead of compounding them.

**Why:** This keeps the established +20%/+40% tier meanings consistent: a 1x team and a sole 2x event contributor have +60%, not +68%, priority. Role-weighting prevents one named player from receiving the entire defense's bonus.

**How to apply:** Preserve availability exclusions, observed zeroes, and offensive tier semantics. Clearly label unknown-history role priors and the defensive adjustments as uncalibrated; do not imply guaranteed point or event increases.

Resolve approved defensive defaults only when creating new forecast inputs. An old saved input without defensive-tier metadata must remain neutral, even when its team or player names now have approved tags.

**Why:** Lineups can replay frozen inputs to reconstruct missing DST summaries. Applying today's defaults during that replay would change the defensive forecast while retaining the old offensive projections and misrepresent the saved simulation.

**How to apply:** Never look up current roster tags or introduce new default boosts inside legacy replay. Preserve the recorded seed, input fields, and random-draw sequence. Users must rerun and save forecasts to adopt new defensive settings.