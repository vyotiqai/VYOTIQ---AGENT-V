# Audit findings (ranked)

**Date:** 2026-08-01 (updated pass 6: 2026-08-02)  
**Scope:** Product/runtime gaps in this repo — **not** source-integrity. For claim/URL verification see [`10-source-integrity.md`](./10-source-integrity.md).  
**Rule:** Only evidence-backed items. Deferred items state why.

## P0 — Fix in this pass (bugs / missing coverage / dead hook)

| ID | Finding | Evidence | Action | Status |
|----|---------|----------|--------|--------|
| F1 | Soft read-before-edit warning has no unit test | `executeStepTools.ts` soft warn | Add tests | **Done** (pass 1) |
| F2 | `isFileMutationToolName` defined but never called | `loopPolicy.ts` | Soft post-mutation nudge when step mutates without `diagnostics` | **Done** (pass 1) |
| F3 | E2E does not exercise runAgent tool loop | smoke-only | `tests/main/e2e/agentPipeline.test.ts` | **Done** (pass 1) |

## Pass 2 — Verified and fixed

| ID | Finding | Evidence | Action | Status |
|----|---------|----------|--------|--------|
| F4 | Successful `delete` never clears `knownPaths`, so delete→recreate→edit skips soft unread warn + receipt observation | `loopPolicy.ts` `editPathsFromToolCall` omitted `delete`; `applyToolCallToKnownPaths` only `add`s | Invalidate path (+ descendants) on successful delete | **Fixed** |
| F5 | Nested agent sets `runSignal: options.signal` (combined), so soft interrupt labels tools **Cancelled** instead of **Interrupted** | `nestedAgent.ts` toolCtx; contrast `loop.ts` `runSignal: controller.signal` | Thread parent hard-cancel `runSignal` through `ToolExecutionContext` → `runSubagent` → `runNestedAgent` | **Fixed** |
| F6 | `runsResolveWrites` maps “already resolved” / “not found” to `IPC_HANDLER` | `register.ts` catch → `failFrom`; contrast `runsUndoWrites` user `fail` | User-facing `fail(msg)` for those cases | **Fixed** |
| F7 | `harnessPreviewApply` / `harnessApply` expected proposal/confirm errors → `IPC_HANDLER` | `harnessApply.ts` throws; IPC `failFrom` | Catch known user-state messages → `fail(msg)` | **Fixed** |

## Pass 3 — Verified and fixed

| ID | Finding | Evidence | Action | Status |
|----|---------|----------|--------|--------|
| F8 | Delete knownPaths invalidation gated on `recursive===true`, but `toolDelete` always removes dir trees on success | `loopPolicy.ts` vs `tools/deletePath.ts` `rmSync(..., { recursive: true })` for dirs | Always clear path + descendants on successful delete | **Fixed** |
| F9 | `runsUndoWrites` still mapped “already undone” / “checkpoint not found” → `IPC_HANDLER` (same class as F6) | `register.ts` catch; `checkpoints.ts` throws | User-facing `fail(msg)` | **Fixed** |
| F10 | E2E lacked multi-step `runAgent` soft-nudge persistence + delete/unread + Interrupted vs Cancelled | `tests/main/e2e/agentPipeline.test.ts` | Extended e2e coverage | **Fixed** |

## Pass 4 — Verified and fixed (nested/subagent)

| ID | Finding | Evidence | Action | Status |
|----|---------|----------|--------|--------|
| F13 | Registry dispose aborted only the soft child signal; nested tools labeled **Interrupted** (dispose ≠ soft interrupt) | `subagentRegistry.ts` single controller; `abortToolContent` uses `runSignal` | Split `hardSignal` (dispose-only); combine with parent `runSignal` in `runSubagent` | **Fixed** |
| F14 | Nested live-event drain bailed on `signal.aborted` before tools settled, dropping Interrupted/Cancelled `tool_result` to parent | `nestedAgent.ts` drain loop vs `loop.ts` wait-for-settle + catch-up emit | Main-loop parity: wait for settle; emit missed `tool_result`s | **Fixed** |
| F15 | No deep e2e through `runSubagent` → nested tools for abort labels / dispose / exclusions | Prior e2e stopped at `executeStepTools` boundary | `tests/main/e2e/nestedAgentPipeline.test.ts` | **Fixed** |

## Pass 5 — Verified and fixed (wake re-audit)

| ID | Finding | Evidence | Action | Status |
|----|---------|----------|--------|--------|
| F11 | `resolveWrites` soft no-op (`checkpointId: ''`) then `persistWriteCheckpointEvent` → `getWriteCheckpointMeta` asserts UUID → `IPC_HANDLER` | `checkpoints.ts` soft return + `loadMeta` assert; `register.ts` persist | Empty/invalid id → `null` (no throw); persist early-return | **Fixed** |
| F12 | Nested outcome report always said “cancelled” on any `signal.aborted`, including soft interrupt | `nestedAgent.ts` finalize messages | `nestedAbortReport` uses `runSignal` like tool abort labels | **Fixed** |

## Pass 6 — Verified and fixed (second evidence re-audit)

| ID | Finding | Evidence | Action | Status |
|----|---------|----------|--------|--------|
| F16 | `runsRename` mapped “Cancel run first” / “Run not found” / “Invalid run status” → `IPC_HANDLER` | `register.ts` catch → `failFrom`; contrast `runsDelete` → `fail(result.error)` | User-facing `fail(msg)` | **Fixed** |
| F17 | `chatRewindAndStart` mapped prepareRewind user-state (`editMessageIndex…`, `Run not found`) → `IPC_HANDLER` | `register.ts` outer catch; `rewindRun.ts` throws | User-facing `fail(msg)` | **Fixed** |
| F18 | Undo/resolve still mapped `Invalid checkpoint id` → `IPC_HANDLER` (same class as F6/F9) | `checkpoints.ts` `assertValidCheckpointId`; IPC regex missed it | Include `/invalid checkpoint/` in user `fail` | **Fixed** |

## P1 — Verified solid (do not redo)

| ID | Finding | Evidence |
|----|---------|----------|
| OK1 | `workspaceHasEditableHarness` missing-root → false | `harnessApply.ts` + tests |
| OK2 | `compactModelCacheOnBoot` | `modelCache.ts` + `index.ts` |
| OK3 | Mode / approval / harness apply gates | modePolicy, toolApproval, harnessApply |
| OK4 | Soft diagnostics nudge is step-level (order-blind co-batch) by design + tests | `executeStepTools.ts` + unit/E2E |

## P2 — Deferred (intentional or out of scope)

| ID | Finding | Why deferred |
|----|---------|--------------|
| D1 | No hard verify-before-done | Architecture + harness tests forbid; **product decision required** — Phase 2 kept soft-only (no silent harden) |
| D2 | No hard read-before-edit block | Soft warn only by design |
| D3 | No software factory / swarms | Plan out of scope |
| D4 | Stale rows in older `docs/research/01-current-state-audit.md` (image tools / custom provider) | Note only; fix docs if touched — not agent runtime |
| D5 | Dead exports (`isInspectToolName` unused in prod, `isMalformedToolCall` re-export) | Cleanup only; not a reliability break — skip unless touching those surfaces |
| D6 | `generate_image` / `edit_image` omitted from knownPaths + soft diagnostics nudge | Product choice: diagnostics nudge targets typecheck/lint; ask before treating images as mutations |
| D7 | Dead `runWithStreamRetry` exhaust path silently returns (unused by production loops) | Latent foot-gun only; production uses inline retry in `loop.ts` / `nestedAgent.ts` |

## Docs drift note

`docs/research/01-current-state-audit.md` still understates shipped image tools and custom provider vs live `providers/index.ts`. Prefer `07-vyotiq-mapping.md` + architecture for agentic decisions.
