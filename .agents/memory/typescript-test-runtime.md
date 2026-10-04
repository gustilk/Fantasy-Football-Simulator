---
name: TypeScript test runtime
description: Running focused pure-TypeScript tests without adding a test runner.
---

Prefer the installed Node runtime's native TypeScript support for focused pure-TypeScript tests, with explicit `.ts` extensions in runtime imports.

**Why:** Native TypeScript is available, but root-level `tsx` execution has not consistently been available. The scripts workspace may have its own executable; assuming the root can find it causes unnecessary failed checks.

**How to apply:** Use `node --test` for tests without JSX or runtime path aliases. Confirm the Node version after an environment change; use the project's bundler for JSX-based checks.

Native strip-only execution does not support TypeScript parameter properties in transitively imported server code. Use `--experimental-transform-types` for those tests.

**Why:** Tests that import source parsers can reach server error classes with parameter properties even when the test itself uses only erasable TypeScript.

**How to apply:** Distinguish unsupported TypeScript syntax from a failing application test; enable native transformation rather than adding a runner solely for that syntax.

Standalone React rendering checks must use the frontend's React package resolution and an explicit JSX runtime.

**Why:** A focused accuracy test reached its assertions successfully only after resolving React from the app workspace and supplying React for the standalone runner's classic JSX transform. The same component worked under Vite's automatic JSX runtime; the errors were runner configuration, not app defects.

**How to apply:** Check the scripts workspace for its installed TSX runner before using it. For SSR tests outside the app package, resolve React/React DOM from the frontend package and match the JSX transform. Keep any classic-JSX shim in test setup, not production components.