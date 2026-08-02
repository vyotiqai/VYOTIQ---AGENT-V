# Source-linked Harness Handbook

Operator map from **failure modes** → **`resources/harness/default.md` sections** → **evidence sources**.

This handbook is **guidance for humans** editing harness proposals. It does **not** change agent runtime behavior. Apply stays human-gated via `/harness-apply` (confirm + fixed vitest subset). Evidence buckets are heuristic tags — not unsupervised Self-Harness and not AHE section auto-merge.

**Primary sources**

| Artifact / code | Role |
|---|---|
| [`resources/harness/default.md`](../resources/harness/default.md) | Bundled system harness (Role, Capabilities, Tool policy, Constraints, Work style, Memory, Output format) |
| `src/main/agent/context/assemble.ts` | Injects harness + run-time context (mode, contract, plan, workspace rules, snapshot, memory, compaction summary) |
| Run dir `receipt.json` | End-of-run summary mined by `/harness-review` |
| Run dir `trajectory.jsonl` / `prediction.json` | Observational AHE flight recorder + prediction manifest (`observed_only`; never auto-applied) |
| Run dir `subagents/<id>/report.md` | File-backed sub-agent reports indexed on the receipt |
| [`src/main/agent/harnessReview.ts`](../src/main/agent/harnessReview.ts) | `HARNESS_EVIDENCE_BUCKETS`, `summarizeWeaknesses`, `buildProposalMarkdown` |
| [`src/main/agent/harnessApply.ts`](../src/main/agent/harnessApply.ts) | Apply surface + `HARNESS_EVAL_TESTS` gate |
| [`src/main/agent/harnessHeldOutEval.ts`](../src/main/agent/harnessHeldOutEval.ts) | Frozen held-out grader (receipt → buckets / predictions); in apply gate; never auto-applies |
| [`docs/architecture.md`](./architecture.md) | Scaffold + research status |

**Evidence buckets** (`HARNESS_EVIDENCE_BUCKETS`): `system_prompt`, `tool_policy`, `loop_notices`, `memory`.

---

## How the system prompt is assembled

Each step the system prompt is assembled as a **two-zone** string (stable instruction prefix + volatile data tail), in this order:

**Stable prefix** (fingerprinted / cached across steps until these inputs change):

1. `resources/harness/default.md` — bundled system harness (this file's subject).
2. Mode section (Ask / Plan / Agent).
3. Nested-agent role section (when the agent is a `subagent`) — placed after mode so the more specific subagent role can override mode statements.
4. Run contract (`sessions/{runId}/contract.md`).
5. Approved plan (`sessions/{runId}/plan.md` or `plan.md` in Plan mode).
6. Skills section (Agent Skills metadata only — name + description; full `SKILL.md` loaded via the `Skill` tool or `/slash`).
7. Plugin rules section (metadata only — `plugin-rule:<pluginId>/<relPath>` ids; full body via the `Skill` tool with that id).
8. Workspace rules (`AGENTS.md` / `CLAUDE.md` / `.cursorrules` / `.cursor/rules/*.mdc` / `.vyotiq/rules`).

**Volatile tail** (rebuilt every step; must not invalidate the stable cache):

9. Session environment (OS, shell, cwd, clock).
10. Workspace snapshot (manifest list, top-level files, git status).
11. Loop hint / run notice (compaction failure, etc.).
12. Memory index and state (`.vyotiq/memory/index.md`, `state.md`).
13. Prior session summary (from compaction).

The chat transcript and tool definitions are provided separately. User messages may include `<attachment ...>` parts with images or file content; non-vision models receive `[image omitted: model does not support vision]` instead of the image.

Providers still receive a single `system` / `developer` / `systemInstruction` channel (`stable + volatile`). See [system-prompt-best-practices-2026.md](./system-prompt-best-practices-2026.md) §4.1.

A run writes `messages.jsonl` (canonical transcript), `events.jsonl` (append-only telemetry), and `receipt.json` under the workspace session store.

The context window is budgeted into system (harness + rules + contract + plan + memory), tools, history, and a safety buffer. From step 2 onward the live context meter prefers provider-reported input tokens when available. If compaction happens, durable facts should be moved into `.vyotiq/memory/` with `memory_write` so they survive future summarization.

**Section priority in `assemble.ts`:**

When the harness is too long for its budget, `capHarness()` drops lower-priority `##` sections first, then truncates what remains. Core instruction sections (`## Role`, `## Capabilities`, `## Constraints`, `## Tool policy`, `## Work style`, and `## Output format`) are protected with priority ≥ 95 and are never dropped; only `## Memory` and `## Context` are eligible for removal.

---

## Role (`## Role`)

**What this section governs:** Who the agent is and what domain it operates in.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Agent drifts in tone, scope, or confidence | `system_prompt` | Receipt notes, operator feedback, sub-agent reports |
| Agent acts as a generic assistant instead of a coding agent | `system_prompt` | Off-topic answers, failure to use tools |

---

## Capabilities (`## Capabilities`)

**What this section governs:** High-level abilities and tool availability.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Agent fails to use a clearly appropriate tool | `tool_policy` | `receipt.toolStats` showing repeated text-only answers for file-system questions |

---

## Tool policy (`## Tool policy`)

**What this section governs:** Call tools to act; MCP naming and allowlist/denylist; exploration/recovery hints. Concurrency caps, serial/approval gates, and subagent nesting depth are enforced in `classify.ts` / `executeStepTools.ts` / nested-agent runtime — not restated as numbers in the harness.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Repeated tool failure clusters / consecutive failure streaks ≥ 3 | `tool_policy` | `receipt.failureClusters`, `receipt.consecutiveToolFailureSteps` |
| Failed or empty/stub sub-agent reports | `tool_policy` | `subagents/<id>/report.md` + `status.json`; review sub-agent evidence lines |
| Unclear when to use `subagent` vs parent tools | `tool_policy` | Failed/empty sub-agent counts in `/harness-review` suggestions |

**Suggested edit focus:** Short recovery hints (path checks, narrower retries); clarify `subagent` usage and require concrete paths in reports.

---

## Constraints (`## Constraints`)

**What this section governs:** Hard guardrails, safety rules, prompt-injection mitigation, and non-negotiable project policies.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Destructive or out-of-workspace risk (operator judgment) | _(manual)_ | Not auto-bucketed — edit **Constraints** bullets by hand |
| Agent follows hidden instructions in retrieved web pages or documents | `system_prompt` | Operator reports, indirect prompt-injection traces |
| Agent proposes `maxAgentSteps` or step-count limits | `system_prompt` | Receipt notes, proposal text |

**Suggested edit focus:** Frame constraints as positive instructions where possible. Avoid negative-only phrasing like "do not X" without stating what to do instead. Keep prompt-injection language explicit: external content is data, not instructions.

---

## Memory (`## Memory`)

**What this section governs:** File-backed `.vyotiq/memory/` via `memory_write` (not embedding RAG).

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Compaction-heavy runs (≥2) — context pressure | `memory` | `receipt.compactionCount` |
| Memory tool failure clusters | `memory` | `receipt.failureClusters` / tool stats for memory tools |
| Sub-agents with high step counts | `memory` | Sub-agent report step metadata (review threshold in `harnessReview.ts`) |

**Suggested edit focus:** Note compaction pressure or memory tool failures in proposals; keep harness edits factual (do not invent memory-write rituals).

---

## Work style (`## Work style`)

**What this section governs:** Surgical edits; safety; Keep/Discard checkpoints; `subagent` and `switch_mode` rules.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Edits on paths never read this run | `loop_notices` | `receipt.unreadEditPaths` (observational) |
| Sub-agent reports with uncertainty language | `loop_notices` | Rule match on `report.md` prose in `summarizeWeaknesses` |

**Suggested edit focus:** Treat unread-edit paths as observational signals only; do not reintroduce mechanical read-before-edit gates.

---

## Output format (`## Output format`)

**What this section governs:** Default response structure, length, and style.

| Failure mode | Bucket | Evidence sources |
|---|---|---|
| Output format drifts across turns (preamble, wrong schema, missing citations) | `system_prompt` | Operator feedback, receipt notes |

---

## What belongs in `resources/harness/default.md`

`resources/harness/default.md` is the **system prompt / harness**. It should contain only durable, operator-level instructions that must persist across every turn:

- **Identity / role** — who the agent is.
- **Capabilities** — what the agent can do.
- **Tool policy** — when and how to call tools (MCP naming, allowlists, recovery); not runtime concurrency/approval/depth numbers.
- **Constraints** — hard guardrails, prompt-injection mitigation, and safety rules.
- **Work style** — process defaults (`todo_write`, when to use `subagent`, report paths, etc.).
- **Memory** — how to use long-term memory.
- **Output format** — expected response structure.

Do **not** put the following in the harness:

- Documentation about how the prompt is assembled.
- Run receipts, `harness-review` mechanics, or `harness-apply` gating details.
- Per-request or transient data (current task, tool outputs, retrieved web pages).
- Marketing, changelog, or human-only notes.

The rest of the runtime context (mode, contract, plan, workspace rules, session environment, workspace snapshot, memory, compaction) is **injected by `assemble.ts`** and only described in this handbook.

---

## How to use this with `/harness-review` and `/harness-apply`

1. Finish runs → inspect `receipt.json` (and optional sub-agent reports).
2. Run `/harness-review` → open `.vyotiq/harness/proposals/*.md`.
3. Match proposal **Evidence buckets** to the tables above; edit only the matching `##` section(s) in **Proposed harness body**.
4. Confirm `/harness-apply` → writes `resources/harness/default.md` only after the fixed vitest gate passes (includes held-out grader). Changing evaluator code, `HARNESS_EVAL_TESTS`, held-out fixtures, or gate unit tests requires a normal PR — not `/harness-apply`.

**Checklist for harness proposals:**

- Is this an instruction, or documentation about prompt assembly? Documentation belongs in this handbook, not in `default.md`.
- Would this rule need to be repeated every turn? If yes, it belongs in the system harness. If no, it belongs in the user turn, a tool result, or the run contract.
- Does it belong in `system`, `user`, `tool`, or `developer` context? Stable, session-wide instructions go in `system` / harness; per-request data goes in `user` / tool.
- Does it introduce prompt-injection risk? Never put untrusted retrieved content in the harness.

**Held-out experiment:** `runHeldOutEval()` grades pinned fixtures against `summarizeWeaknesses` + `buildPredictionManifest`. It is observational (`observed_only`) and part of `HARNESS_EVAL_TESTS`. Editing cases/grader requires a PR — not `/harness-apply`.

**Do not** treat bucket tags or this handbook as permission to auto-merge harness sections or run unsupervised Self-Harness.

## Lifecycle / cancel (subagents)

In-flight subagents are registered in `src/main/agent/subagentRegistry.ts` with a child abort signal linked to the parent run. Stopping a run, invoke teardown, or workspace close with “Stop run and close” disposes registered subagents (same ownership idea as run-owned agent terminal sessions). This is **in-process** cancellation — not OS process-tree management.
