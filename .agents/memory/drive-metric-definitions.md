---
name: Drive metric definitions
description: Interpretation of the requested drive efficiency and separate explosiveness inputs.
---

Use down-and-distance yardage success (40% on first down, 60% on second, 100% on third/fourth; turnovers fail), inclusive gains of at least 15 yards for explosiveness, and offensive touchdowns per drive reaching the opponent's 20 for red-zone conversion.

**Why:** The user requested drive outcomes based on team success and red-zone efficiency, plus a separate explosive-play metric. EPA or average yards must not be relabeled as those observed metrics, and the "15+" boundary needs a consistent interpretation.

**How to apply:** Keep denominators and missing observations distinct, count a red-zone drive once, and exclude long touchdowns that never entered the red zone from its conversion denominator. Document any changed definitions and preserve older frozen-model replay.

Treat the conversion hazard, matchup adjustments and neutral priors as heuristic assumptions until independently evaluated.

**Why:** Adding more football detail does not by itself demonstrate more accurate scores or fantasy projections. A per-play finishing hazard does not guarantee its realized drive conversion frequency matches the source rate.

**How to apply:** Validate observed versus simulated success, explosive-play and red-zone conversion frequencies on eligible held-out evidence before claiming accuracy gains or tuning mappings.
