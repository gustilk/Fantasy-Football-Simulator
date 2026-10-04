---
name: DraftKings save integrity
description: Quota recovery must preserve frozen forecasts and distinguish new results from an older saved slate.
---

Preserve complete frozen forecast inputs when changing archive storage. Do not solve quota failures by dropping model inputs, deleting old slates automatically, or clearing unrelated browser data.

**Why:** Repeated full-slate runs exceeded browser localStorage capacity. A failed save left the previously selected partial slate displayed, including an older Rams depth-chart error, even while a fresh Rams chart and simulation succeeded. This made a storage failure appear to be a recurring source failure.

**How to apply:** Validate and verify migrated saves before removing their legacy storage entry. Merge concurrent-tab changes atomically. Keep failed-save results explicitly unsaved, available for retry and export without recomputing, and retained across in-app navigation. Do not claim results persisted until the storage transaction completes. Larger browser storage remains device-and-origin-specific, not a cross-device backup.