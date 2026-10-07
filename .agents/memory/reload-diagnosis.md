---
name: Reload diagnosis
description: User expectations for unexpected refreshes and distinguishing preview from published use.
---

The user does not want the app to refresh itself during use. Remembering the current section after a reload does not satisfy that request.

**Why:** The user explicitly corrected a section-restoration-only fix because the unwanted refresh still happened. They described their site as published, but the actual browser link was a development preview.

**How to apply:** Check the actual URL rather than relying only on the user's preview/published label. Development previews can reload during edits and server restarts; the published app is separate. Diagnose the reload trigger before declaring it fixed, and do not confuse background data fetching with full-page navigation.
