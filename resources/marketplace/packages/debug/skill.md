---
name: debug
description: Use when diagnosing failures, crashes, hangs, or unexpected runtime behavior.
version: 1.0.0
---

# Debug

When debugging:

1. Reproduce with the smallest failing case before changing code.
2. Read the full error, stack, and recent diffs carefully.
3. Form one hypothesis; gather evidence; only then patch.
4. Prefer logging, breakpoints, or a focused test over speculative rewrites.
5. Change one variable at a time when narrowing root cause.
6. Confirm the fix by re-running the failing path.
7. Report root cause and fix briefly; avoid long narratives of dead ends.
