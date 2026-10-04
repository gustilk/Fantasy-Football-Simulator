---
name: TypeScript test runtime
description: Running focused pure-TypeScript tests without adding a test runner.
---

Prefer the installed Node runtime's native TypeScript support for focused pure-TypeScript tests, with explicit `.ts` extensions in runtime imports.

**Why:** This environment has a Node runtime that supports TypeScript stripping but no accessible `tsx` executable. Assuming `pnpm exec tsx` works causes unnecessary failed checks.

**How to apply:** Use `node --test` for tests without JSX or runtime path aliases. Confirm the Node version after an environment change; use the project's bundler for JSX-based checks.

Native strip-only execution does not support TypeScript parameter properties in transitively imported server code. Use `--experimental-transform-types` for those tests.

**Why:** Tests that import source parsers can reach server error classes with parameter properties even when the test itself uses only erasable TypeScript.

**How to apply:** Distinguish unsupported TypeScript syntax from a failing application test; enable native transformation rather than adding a runner solely for that syntax.