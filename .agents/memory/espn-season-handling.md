---
name: ESPN season handling
description: Non-obvious season mismatches in ESPN's public NFL site data.
---

Do not assume ESPN's public endpoints honor a season query just because the request succeeds.

**Why:** A request for a 2024 roster returned 2024, while the accompanying regular-season schedule request returned 2026. Combining those successful responses would silently put the wrong season's games into a team library.

**How to apply:** Check the returned roster, schedule, depth-chart, and game season independently against the requested season. Reject mismatches explicitly; do not silently use a different season or claim historical coverage from a successful HTTP response alone.