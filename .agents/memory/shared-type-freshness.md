---
name: Shared type freshness after merges
description: Source API exports and compiled workspace declarations can temporarily disagree after an API-contract merge.
---

Treat missing-export errors after a merge as potentially stale declarations, not automatically missing source APIs.

**Why:** A merged API client contained the required public source exports, while an artifact-only typecheck still consumed older compiled declarations. Refreshing the shared-library build resolved the mismatch without changing callers or generated API source.

**How to apply:** Verify the current generated source and the package's compiled declarations before inventing replacement APIs or weakening types. Use the workspace-level library build before checking individual artifacts after shared-contract changes.
