---
name: API path validation
description: Numeric enum path parameters need explicit coercion before generated validators.
---

Generated numeric-enum path validators use literal unions and do not coerce HTTP strings, even when neighboring integer path validators do.

**Why:** A valid numeric enum arrives from Express as a string and otherwise fails validation despite the generated client's correct request.

**How to apply:** Validate the allowed string representation and convert it to a number before passing path parameters to the generated validator. Do not edit generated code; verify valid and invalid HTTP requests.
