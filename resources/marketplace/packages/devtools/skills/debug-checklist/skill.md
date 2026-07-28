---
name: debug-checklist
description: Use when debugging failing tests, crashes, or unexpected runtime behavior.
version: 1.0.0
---

# Debug checklist

1. Reproduce with the smallest failing case.
2. Read the error and stack carefully before changing code.
3. Form one hypothesis; gather evidence; only then patch.
4. Prefer logging or a focused test over large speculative edits.
5. Confirm the fix with a re-run of the failing path.
