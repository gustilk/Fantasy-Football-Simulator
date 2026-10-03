---
name: TypeScript test runtime
description: Running focused pure-TypeScript tests without adding a test runner.
---

Prefer the installed Node runtime's native TypeScript support for focused pure-TypeScript tests, with explicit `.ts` extensions in runtime imports.

**Why:** This environment has a Node runtime that supports TypeScript stripping but no accessible `tsx` executable. Assuming `pnpm exec tsx` works causes unnecessary failed checks.

**How to apply:** Use `node --test` for tests without JSX or runtime path aliases. Confirm the Node version after an environment change; use the project's bundler for JSX-based checks.