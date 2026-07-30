# Source-linked Harness Handbook

Operator map from **failure modes** → **`resources/harness/default.md` sections** → **evidence sources**.

This handbook is **guidance for humans** editing harness proposals. It does **not** change agent runtime behavior. Apply stays human-gated via `/harness-apply` (confirm + fixed vitest subset). Evidence buckets are heuristic tags — not unsupervised Self-Harness and not AHE section auto-merge.

**Primary sources**

| Artifact / code | Role |
|---|---|
| [`resources/harness/default.md`](../resources/harness/default.md) | Bundled system harness (Context, Tool policy, Memory, Work style) |
| Run dir `receipt.json` | End-of-run summary mined by `/harness-review` |
| Run dir `trajectory.jsonl` / `prediction.json` | Observational AHE flight recorder + prediction manifest (`observed_only`; never auto-applied) |
| Run dir `subagents/<id>/report.md` | File-backed sub-agent reports indexed on the receipt |
| [`src/main/agent/harnessReview.ts`](../src/main/agent/harnessReview.ts) | `HARNESS_EVIDENCE_BUCKETS`, `summarizeWeaknesses`, `buildProposalMarkdown` |
| [`src/main/agent/harnessApply.ts`](../src/main/agent/harnessApply.ts) | Apply surface + `HARNESS_EVAL_TESTS` gate |
| [`src/main/agent/harnessHeldOutEval.ts`](../src/main/agent/harnessHeldOutEval.ts) | Frozen held-out grader (receipt → buckets / predictions); in apply gate; never auto-applies |
| [`docs/architecture.md`](./architecture.md) | Scaffold + research status |

**Evidence buckets** (`HARNESS_EVIDENCE_BUCKETS`): `system_prompt`, `tool_policy`, `loop_notices`, `verify`, `memory`.

---

## Context (`## Context`)

**What this section governs:** What the agent receives each turn (chat, harness, snapshot, memory, contract, plan, mode, tools catalog); how contract / verify-before-done / receipts / harness-review–apply relate to finishing and improving the harness.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Agent finishes without meeting checkable Done-when / verify expectations | `verify` | `receipt.verifyBeforeDone`, `receipt.contractDoneWhen`, victory-claim-without-tools, verify nudges |
| Recurring sub-agent tasks suggest missing parent guidance | `system_prompt` | Sub-agent `report.md` task text (≥2× same normalized task); proposal meta line to keep harness small |
| Operators unsure which harness surface to edit | `system_prompt` | Proposal `## Evidence buckets` → map to a **narrow** `default.md` edit |

**Receipt / review citations:** `verifyBeforeDone.*`, `contractDoneWhen.*`, `subagents[]`, proposal sections `## Evidence` / `## Evidence buckets`.

**Apply gate:** Only `resources/harness/default.md` is written; gate sources dirty or git status failure → refuse; vitest failure → revert.

---

## Tool policy (`## Tool policy`)

**What this section governs:** Call tools to act; read-before-edit; MCP naming/approval; parallel read-only exploration.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Repeated tool failure clusters / consecutive failure streaks ≥ 3 | `tool_policy` | `receipt.failureClusters`, `receipt.consecutiveToolFailureSteps` |
| Failed or empty/stub sub-agent reports | `tool_policy` | `subagents/<id>/report.md` + `status.json`; review sub-agent evidence lines |
| Unclear when to use `subagent` vs parent tools | `tool_policy` | Failed/empty sub-agent counts in `/harness-review` suggestions |

**Suggested edit focus:** Short recovery hints (path checks, narrower retries); clarify `subagent` usage and require concrete paths in reports.

---

## Memory (`## Memory`)

**What this section governs:** File-backed `.vyotiq/memory/` via `memory_write` (not embedding RAG).

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Compaction-heavy runs (≥2) — context pressure | `memory` | `receipt.compactionCount` |
| Memory tool failure clusters | `memory` | `receipt.failureClusters` / tool stats for memory tools |
| Sub-agents with high step counts | `memory` | Sub-agent report step metadata (review threshold in `harnessReview.ts`) |

**Suggested edit focus:** Prefer durable `memory_write` over relying on long context alone when pressure or memory failures recur.

---

## Work style (`## Work style`)

**What this section governs:** Inspect before guessing; todos; surgical edits; safety; Keep/Discard checkpoints; `switch_mode`.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Edits on paths never read this run | `loop_notices` | `receipt.unreadEditPaths`; Settings `readBeforeEdit` |
| Sub-agent reports with uncertainty language | `loop_notices` | Rule match on `report.md` prose in `summarizeWeaknesses` |
| Destructive or out-of-workspace risk (operator judgment) | _(manual)_ | Not auto-bucketed — edit **Work style** Safety bullets by hand |

**Suggested edit focus:** Strengthen read-before-edit / Work style for paths that repeatedly appear unread.

---

## How to use this with `/harness-review` and `/harness-apply`

1. Finish runs → inspect `receipt.json` (and optional sub-agent reports).
2. Run `/harness-review` → open `.vyotiq/harness/proposals/*.md`.
3. Match proposal **Evidence buckets** to the tables above; edit only the matching `##` section(s) in **Proposed harness body**.
4. Confirm `/harness-apply` → writes `resources/harness/default.md` only after the fixed vitest gate passes (includes held-out grader).

**Held-out experiment:** `runHeldOutEval()` grades pinned fixtures against `summarizeWeaknesses` + `buildPredictionManifest`. It is observational (`observed_only`) and part of `HARNESS_EVAL_TESTS`. Editing cases/grader requires a PR — not `/harness-apply`.

**Do not** treat bucket tags or this handbook as permission to auto-merge harness sections or run unsupervised Self-Harness.

## Lifecycle / cancel (subagents)

In-flight subagents are registered in `src/main/agent/subagentRegistry.ts` with a child abort signal linked to the parent run. Stopping a run, invoke teardown, or workspace close with “Stop run and close” disposes registered subagents (same ownership idea as run-owned agent terminal sessions). This is **in-process** cancellation — not OS process-tree management.
