# E2E verification

**Date:** 2026-08-02 (pass 4 nested focus; later passes may extend)  
**Commands run (nested pass):**

```text
pnpm exec vitest run tests/main/e2e/nestedAgentPipeline.test.ts tests/main/e2e/agentPipeline.test.ts tests/main/unit/subagentRegistry.test.ts tests/main/unit/subagent.test.ts tests/main/unit/executeStepTools.test.ts tests/main/unit/loopPolicy.test.ts
```

**Result:** 6 files, 85 tests — **all passed**. `pnpm build` OK; `pnpm start` restarted per build-and-restart rule.

## Coverage

| Test file | What it proves |
|-----------|----------------|
| `tests/main/e2e/nestedAgentPipeline.test.ts` | `runSubagent` → `runNestedAgent` → `executeStepToolCalls`: `runSignal` forward; soft → Interrupted; hard cancel → Cancelled; dispose → Cancelled; excluded tools; `subagent_event` wrapping |
| `tests/main/e2e/agentPipeline.test.ts` | Provider → tool → done; soft-nudge; cancel; Ask/Agent; delete/unread; Interrupted vs Cancelled at executeStepTools |
| `tests/main/unit/subagentRegistry.test.ts` | Parent abort ≠ hardSignal; dispose aborts soft + hard |

## Pass 4 nested polish

- Registry `hardSignal` so dispose labels nested tools **Cancelled** (F13)
- Nested live-event drain waits for tool settle (F14)
- Deep nested e2e suite (F15)

## Deferred (unchanged)

Hard verify-before-done / hard read-before-edit — see `08-audit-findings.md` P2. Soft diagnostics nudge stays advisory-only.
