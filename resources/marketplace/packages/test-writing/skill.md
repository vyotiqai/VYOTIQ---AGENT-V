---
name: test-writing
description: Use when adding, fixing, or expanding automated tests (unit, integration, or UI).
version: 1.0.0
---

# Test writing

When writing or fixing tests:

1. Match the project's existing test runner, layout, and assertion style.
2. Cover the failing or risky path first; avoid speculative broad suites.
3. Prefer focused cases with clear arrange / act / assert structure.
4. Assert observable behavior, not private implementation details.
5. Name tests after the behavior under test, not the implementation.
6. Re-run the relevant tests after changes and fix failures you introduce.
7. Ask 1–2 clarifying questions only when the intended behavior is ambiguous.
