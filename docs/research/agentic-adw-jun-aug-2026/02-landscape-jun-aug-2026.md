# Landscape Jun–Aug 2026 (labs vs ADW vocabulary)

**Sources:** S1–S29 (see [`00-source-inventory.md`](./00-source-inventory.md)); S1–S2 for ADW labels.  
**Dating caveat:** Pack title says “Jun–Aug 2026” but **foundational lab essays are often Jan–May 2026** (still governing). Treat rows marked **outside** as background, not as Jun–Aug publications. **In-window** Jun–Jul: Claude Steering, Anthropic SDLC, MCP auth, GitHub Copilot changelogs, Cursor swarm economics (**2026-07-20** related-strip), cloud-agent lessons (≈ late Jul). See [`10-source-integrity.md`](./10-source-integrity.md).

| Date / window | Source | Claim (verbatim gist) | ADW mapping | Confidence |
|---------------|--------|----------------------|-------------|------------|
| **2026-07-30** | GitHub VS Code / VS Copilot (S27/S28) | Worktrees for Copilot/Claude/Codex; track subagents; Agent (Preview) on SDK | Isolation + harness UX | Verified primary (**in window**) |
| **≈ late Jul 2026** | Cursor [cloud-agent-lessons](https://cursor.com/blog/cloud-agent-lessons) | Full VM env is the product; durable long runs; computer-use subagent; self-healing env roadmap | Cloud isolation / ADW graduate path | Verified primary (**in window**; page undated; related Jul 20–30) |
| **2026-07-29** | GitHub CCR skills/MCP GA (S26) | Skills + MCP in code review; MCP tool calls **read-only** | Review ADW node | Verified primary (**in window**) |
| **2026-07-28** | MCP auth security (S12) | OAuth 2.1; resource/audience; no token passthrough | External tool trust boundary | Verified primary (**in window**) |
| **2026-07-21** | Anthropic AI-native SDLC (S11) | Deterministic + agentic security reviews; encode guidance in CLAUDE.md; humans at high leverage | Code + agent review nodes | Verified primary (**in window**) |
| **2026-07-20** | Cursor swarm economics (S5) | Frontier planner + cheap workers; stacked review; context efficiency | Price/performance of ADW nodes | Verified primary (**in window**; date from related-strip on cloud-agent-lessons) |
| **2026-07-13** | IndyDevDan / OpenClaw (S1/S2) | ADW > “loop engineering”; three actors; separate code from agents | Primary framing | Primary / secondary |
| **2026-06-18** | Claude Steering (S18) | Seven instruction methods; hooks bypass compaction; skills on-demand; subagents return summaries | Authority vs context cost | Verified primary (**in window**) |
| **2026-06-17** | GitHub Agent finder (S25) | Discover MCP/skills on demand; **no auto-install**; enterprise allowlists | Progressive disclosure + human gate | Verified primary (**in window**) |
| **2026-06-01** | GitHub Copilot billing (S24) | Usage-based AI Credits replace premium requests | Cost as ADW constraint | Verified primary (**in window**) |
| **2026-05-28** | Claude dynamic workflows (S19) | Claude writes orchestration scripts; tens–hundreds of subagents; confirm before first run | Multi-agent ADW; human gate | Verified primary (late May → June context) |
| **2026-05-14** | Claude large codebases blog (S6) | CLAUDE.md → hooks → skills → plugins → MCP; hooks deterministic | Skills ≠ enforcement | Verified primary (**outside** window) |
| **2026-04-15** | Claude session / 1M context (S29) | Compaction, context rot, continue/rewind/clear/subagent | Context hygiene | Verified primary (**outside**) |
| **2026-02-24** | Cursor [agent computer use](https://cursor.com/blog/agent-computer-use) | Per-agent cloud VM; artifacts; remote desktop; merge-ready PRs | Worktree → VM isolation | Verified primary (**outside**; changelog 2026-02-24) |
| **2026-02-18** | Cursor agent sandboxing (S9) | OS sandbox; approve only when leaving (often network) | Isolation / engineer constraint | Verified primary (**outside**) |
| **≈ Jan–Feb 2026** | Cursor [self-driving codebases](https://cursor.com/blog/self-driving-codebases) | Planner/subplanner/worker; remove integrator; research throughput tradeoffs | Deepens S4; not IDE default | Verified primary (**outside**; undated follow-up to S4) |
| **2026-02-11** | OpenAI harness engineering (S3) | AGENTS.md as TOC; mechanical linters/CI; worktree-legible apps; agent review | Code + docs SoR | Verified primary (**outside**) |
| **2026-02-04** | OpenAI Codex App Server (S21) | Approvals pause the turn until client responds | Human gate mid-loop | Verified primary (**outside**) |
| **2026-01-23** | OpenAI Codex agent loop (S20) | Infer → tool → append → re-infer until assistant message; auto-compact | Loop = ADW edge | Verified primary (**outside**) |
| **2026-01-14** | Cursor scaling agents (S4) | Flat self-coord failed; planner/worker; remove integrator; model-per-role | Specialization without over-structure | Verified primary (**outside**) |
| Live docs 2026-08-02 | Cursor + Claude worktrees (S15/S16) | Worktree per agent/session; `/best-of-n`; `isolation: worktree` | Branch/FS isolation default | Verified primary (product docs) |
| Live docs 2026-08-02 | Claude permissions + hooks (S13/S14) | deny→ask→allow; exit 2 blocks; CLAUDE.md not enforcement | Code gates for tools | Verified primary |
| Live docs 2026-08-02 | Claude workflows (S18b) | Pause/resume; agent caps; Large workflow warning | Abort / budget | Verified primary |
| Live docs 2026-08-02 | OpenAI compaction (S22) | Server-side threshold or `/responses/compact`; do not prune output | Long-run context | Verified primary |
| Living guide 2026-08-02 | Cursor agent best practices (S23) | Plan Mode waits for approval; verifiable goals (types/linters/tests) | Plan→implement→verify | Verified primary; **first-publish UNVERIFIED** |

## Vocabulary bridge

| Lab term | ADW term | Notes |
|----------|----------|-------|
| Harness | Scaffolding around the model inside an ADW | Necessary, not sufficient |
| Hook (Pre/Post/Stop) | Deterministic code gate | Prefer over skill prose |
| Planner / worker | Specialized agents in a workflow | Keep KISS for single-product agents |
| Loop / fail→retry | Fail→retry edge between code gate and build agent | One node, not the product |
| Ralph Wiggum Loop (OpenAI S3) | Agent-to-agent PR iteration until reviewers satisfied | **OpenAI lab term** — not IndyDevDan ADW vocabulary |
| AGENTS.md / CLAUDE.md | Engineer-authored map into repo knowledge | Keep short; progressive disclosure |
| OS / VM sandbox | Isolation beyond git worktree | S9; computer-use **2026-02-24**; cloud-agent-lessons ≈ late Jul |
| MCP OAuth | Server access authn/z | Distinct from host tool allowlists |
| Plan Mode / workflow confirm / no auto-install | Human gates | S23, S19, S25 |
| Dynamic workflow / ultracode | Multi-agent orchestration ADW | S19, S18b |
| Compaction | Context hygiene between turns | S20, S22, S29, S18 |

## Plan → implement → verify (cross-vendor)

| Phase | Observed practice | Sources |
|-------|-------------------|---------|
| **Plan** | Cursor Plan Mode; Claude workflow script first; short AGENTS.md/CLAUDE.md maps | S23, S19/S18b, S3, S6 |
| **Implement** | Tool loop (S20) or planner/worker (S4/S5) or dynamic workflows (S19); worktree isolation (S15/S16/S27) | as cited |
| **Verify** | Hooks/linters/tests; agent review; Copilot CCR + skills/MCP | S14, S6, S3, S26, S1 |
| **Human gate** | Plan approve; workflow confirm; permissions; no silent MCP install | S23, S19, S13, S25 |

## August 2026 gap

As of 2026-08-02: few **August-dated** deep-dive posts confirmed for this scope. Prefer July changelogs + living docs. **UNVERIFIED:** any “August 2026 introduced X” without a dated URL.

## Non-goals for VYOTIQ from this landscape

- Full software factory / ticket router (out of product scope for this package)  
- Swarm orchestration rewrite / custom high-throughput VCS  
- Adopting “loop engineering” as marketing language in product docs  
- Copying OpenAI minimal merge gates without matching agent throughput
