# Source inventory

**Compiled:** 2026-08-01 · **Extended:** 2026-08-02 (topic densification + integrity-aligned dates)  
**Window:** ADW framing ≈ Jul 2026; lab practices = still-governing 2026 primaries (many Jan–May) + in-window Jul docs

| ID | Source | Date / window | Confidence | Notes |
|----|--------|---------------|------------|-------|
| S1 | IndyDevDan transcript + [YouTube](https://www.youtube.com/watch?v=VQy50fuxI34) | ≈ 2026-07-13 | **Verified primary** (ADW framing) | Exclude CTA as technical authority |
| S2 | OpenClawDatabase analysis of same video | 2026-07-13 | **Verified secondary** | Corroborates S1 |
| S3 | OpenAI — Harness engineering | **2026-02-11** | **Verified primary** | Outside Jun–Aug; still governing |
| S4 | Cursor — Scaling agents | **2026-01-14** | **Verified primary** | Outside Jun–Aug; planner/worker |
| S5 | Cursor — Agent swarm economics | **2026-07-20** (related-strip on cloud-agent-lessons; page undated) | **Verified primary** | Economics + failure modes; **in window** |
| S6 | Claude — Large codebases blog | **2026-05-14** | **Verified primary** | Outside Jun–Aug; layering |
| S6b | Claude Code large-codebases docs | live / fetched 2026-08-02 | **Verified primary** | Nested memory, sparsePaths |
| S7 | VYOTIQ docs (`architecture`, handbook, research) | 2026-08 | **Verified primary** (repo) | |
| S8 | VYOTIQ `src/main/agent/*` | 2026-08 checkout | **Verified primary** | Mapping only |
| S9 | Cursor — Agent sandboxing | **2026-02-18** (related-strip) | **Verified primary** | OS sandbox |
| S10 | Claude Code memory docs | fetched 2026-08-02 | **Verified primary** | Context ≠ enforcement |
| S11 | Anthropic AI-native SDLC security | **2026-07-21** | **Verified primary** | **In Jun–Aug window** |
| S12 | MCP auth security considerations | **2026-07-28** | **Verified primary** | **In Jun–Aug window** |
| S13 | Claude Code permissions | fetched 2026-08-02 | **Verified primary** | deny/ask/allow; MCP rules |
| S14 | Claude Code hooks guide + reference | fetched 2026-08-02 | **Verified primary** | Lifecycle; exit 2 |
| S15 | Cursor worktrees docs | fetched 2026-08-02 | **Verified primary** | Product worktrees; /best-of-n |
| S16 | Claude worktrees / agents / sub-agents | fetched 2026-08-02 | **Verified primary** | `isolation: worktree` |
| S17 | Community gate harnesses (spec-agent, pi-gate, …) | 2026 | **Secondary / Directional** | Existence proof only |
| S18 | Anthropic — Steering Claude Code | **2026-06-18** | **Verified primary** | **In window** — seven methods; hooks vs skills; compaction |
| S19 | Anthropic — Introducing dynamic workflows | **2026-05-28** | **Verified primary** | Late-May context; orchestration scripts; confirm gate |
| S18b | Claude Code — Workflows docs | live / fetched 2026-08-02 | **Verified primary** | Caps; pause/resume; Large workflow warning |
| S20 | OpenAI — Unrolling the Codex agent loop | **2026-01-23** | **Verified primary** | Outside window; canonical tool loop + compaction |
| S21 | OpenAI — Unlocking the Codex harness | **2026-02-04** | **Verified primary** | App Server; approval pause |
| S22 | OpenAI — Compaction guide | live / fetched 2026-08-02 | **Verified primary** | Server-side + `/responses/compact` |
| S23 | Cursor — Agent best practices | living / fetched 2026-08-02 | **Verified primary**; first-publish **UNVERIFIED** | Plan Mode; context; worktrees; verifiable goals |
| S24 | GitHub — Copilot billing (AI Credits) | **2026-06-01** | **Verified primary** | **In window** — agentic cost model |
| S25 | GitHub — Agent finder | **2026-06-17** | **Verified primary** | **In window** — on-demand discovery; no auto-install |
| S26 | GitHub — Copilot code review skills/MCP GA | **2026-07-29** | **Verified primary** | **In window** — MCP read-only in review |
| S27 | GitHub — VS Code July 2026 Copilot | **2026-07-30** | **Verified primary** | **In window** — worktrees any harness; subagent tracking |
| S28 | GitHub — Visual Studio July Copilot | **2026-07-30** | **Verified primary** | **In window** — Agent (Preview) on Copilot SDK |
| S29 | Anthropic — Session management / 1M context | **2026-04-15** | **Verified primary** | Outside window; compaction / context rot |

> **ID note (2026-08-02):** Earlier pack used S9 for hooks and S17 for sandbox inconsistently across parallel edits. This inventory is authoritative: **S9 = Cursor sandboxing**; **S14 = Claude hooks**; **S15/S16 = worktree product docs**; **S18–S29 = Jun–Aug vendor + tool-loop primaries** (added 2026-08-02 landscape pass). Topic files cite by URL+date; prefer URLs over stale IDs when conflicting.

## Unresolved / conflicts

| Topic | Conflict | Resolution for this package |
|-------|----------|------------------------------|
| “Loop engineering” vs ADW | Hype blogs elevate loops; S1/S2 argue loops are one node | Prefer **ADW**; loops = fail→retry edges |
| Harness vs ADW | Labs say “harness”; S1 says harness incomplete alone | Harness = scaffolding inside ADW |
| verify-before-done hard gates | Industry wants code gates; VYOTIQ architecture soft-only | **Conflict — do not code against** without product change |
| Minimal merge gates | OpenAI high-throughput vs small-team risk | Copy mechanical gates + review loops; **not** loose merge by default |
| Skills vs always-on map | Secondary evals disagree on win rate | Critical invariants → map **and** code; skills for heavy/rare |
| MCP OAuth vs tool allowlists | Spec covers authn/z; hosts must own tool policy | Document both layers; don’t conflate |
| Research swarm custom VCS | Cursor research ≠ IDE product default | Cite as research; product guidance = worktrees + sandboxes |
| Pack title vs calendar | Many foundational essays are Jan–May 2026; Jun–Jul has GitHub + Claude Steering/SDLC/MCP | See [`10-source-integrity.md`](./10-source-integrity.md); S18–S28 fill in-window vendor gaps |
| August 2026 deep-dives | Sparse as of 2026-08-02 | **DEFERRED** — prefer July changelogs + living docs; do not invent Aug posts |
| OpenAI Agents SDK numeric retries | No verified universal N | **DEFERRED / UNVERIFIED** — see [`11-tool-use-loop-behaviours.md`](./11-tool-use-loop-behaviours.md) |
| Cloud / self-driving narrative | Was thin at integrity v1 | Filled in `05` + `02` (URL+date; no new S-IDs) |

## Reachability quiet pass (2026-08-02 freeze)

| URL class | Status |
|-----------|--------|
| Core S2–S6, S9–S10, S13–S16, OpenClaw, YouTube shell | **REACHABLE** |
| MCP auth security (S12) | **REACHABLE** (prior intermittent) |
| Anthropic AI-native SDLC (S11) | **REACHABLE** (page date 2026-07-21) |
| Cursor worktrees docs (S15) | **REACHABLE** (prior intermittent) |
| OpenAI Running agents | **REACHABLE** (prior intermittent) |
| Self-driving / computer-use / cloud-agent-lessons / changelog 02-24-26 | **REACHABLE** |
| S17 community gate pages | **REACHABLE** via search; secondary only |

## Fetch status (2026-08-02)

| Source | Fetched |
|--------|---------|
| S1 | Local copy in package |
| S2–S6, S6b, S9–S16 | WebFetch / WebSearch 2026-08-02 |
| S17 | WebSearch project pages |
| S18–S29 | WebFetch / WebSearch 2026-08-02 (vendor landscape / tool-loop pass) |
| Cloud/self-driving URLs | WebFetch 2026-08-02 freeze pass |
| S7–S8 | Workspace read |
