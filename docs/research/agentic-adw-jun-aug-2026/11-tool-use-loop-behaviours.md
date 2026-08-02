# Model / tool-use loop behaviours (Jun–Aug 2026 evidence)

**Compiled:** 2026-08-02  
**IDs:** [`00-source-inventory.md`](./00-source-inventory.md) (S18–S29 + S3/S4/S14/S20–S23)  
**Scope:** How official agent harnesses run tool calling, retries, abort, streaming, and context management.  
**Not in scope:** VYOTIQ implementation audit.

## 1. Canonical agent loop (OpenAI Codex) — S20

**Source:** [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) — **2026-01-23** (Verified primary; outside Jun–Aug; still the clearest public unroll).

Verified behaviours:

1. User input enters the prompt.  
2. Model inference via Responses API.  
3. Model either emits a **final assistant message** (turn ends; control returns to user) or **tool call(s)**.  
4. Harness executes tools, **appends outputs**, re-queries the model.  
5. Repeats until no more tool calls.  
6. One user “turn” may contain **many** model↔tool iterations.  
7. Primary software-agent output may be filesystem changes; turn still ends with an assistant message.

Streaming: tokens are produced incrementally (same post).

### Context & caching (S20)

- Context window includes input **and** output tokens; hundreds of tool calls can exhaust it → **context management is a harness responsibility**.  
- Codex prefers **stateless** requests (avoids `previous_response_id`) for ZDR simplicity.  
- **Prompt caching** requires exact prefix matches: static instructions/tools first; append-only history; deterministic tool order. Mid-conversation tool-list changes (e.g. MCP `tools/list_changed`) can cause expensive cache misses.  
- Compaction: when tokens exceed `auto_compact_limit`, Codex uses `/responses/compact`, replacing input with a smaller item list including opaque encrypted compaction content.

**Living API docs (S22):** [Compaction](https://developers.openai.com/api/docs/guides/compaction) — server-side compaction via `context_management.compact_threshold`, or explicit `/responses/compact`. **Do not prune** compact endpoint output; pass the returned window as-is.

### Approvals / pause (S21)

**Source:** [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/) — **2026-02-04**.

- Bidirectional JSON-RPC: server can initiate requests when the agent needs input (e.g. approval) and **pause the turn** until the client responds.

### Agents SDK runtime (high-level)

**Source:** [Running agents](https://developers.openai.com/api/docs/guides/agents/running-agents) (living docs; full WebFetch intermittent on 2026-08-02 — outline from official docs search).

Documented loop outline:

1. Model may call tools → execute → continue.  
2. May hand off to another agent → continue.  
3. Final answer with no tool work → return.  
4. Streaming uses the same loop; wait for stream finish before treating run as settled.  
5. Cancel mid-stream → resume unfinished turn from `state` if continuing same turn.  
6. Approvals are **paused runs**, not new turns.

**UNVERIFIED:** fine-grained default retry counts / backoff formulas for failed tools.

OpenAI harness-engineering (S3, **2026-02-11**) also describes agent-to-agent PR review iteration until reviewers are satisfied (“Ralph Wiggum Loop” — OpenAI lab term).

## 2. Claude Code: tools, hooks, compaction, abort

### Hooks as deterministic tool gates — S14, S18

**Sources:** [Hooks guide](https://code.claude.com/docs/en/hooks-guide); [Steering](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more) (**2026-06-18**, **in window**).

Verified:

- Hooks run at lifecycle points (including tool use); unlike CLAUDE.md, they are **deterministic**.  
- `PreToolUse` can inspect a tool call and **exit code 2 to deny**.  
- Hook types: command, HTTP, mcp_tool (deterministic execution); prompt / agent (model judgment — agent hooks experimental; prefer command hooks for production).  
- Hooks **bypass compaction** for config (Steering table); some output (e.g. blocking errors) may return into context.

### Context management — S18, S29

**Sources:** Steering **2026-06-18**; [Session management](https://claude.com/blog/using-claude-code-session-management-and-1m-context) **2026-04-15**.

| Mechanism | Behaviour (verified) |
|-----------|----------------------|
| Compaction | Near context limit, summarize and continue; user can `/compact` with steering instructions |
| Context rot | Performance degrades as context grows |
| Subagents | Fresh context; only final report returns to parent |
| Rewind | Drop failed attempt, keep useful reads |
| Clear | New task / zero rot |
| Skills budget | Invoked skills re-injected up to shared budget; oldest dropped first |

### Multi-agent / abort / budgets — S19, S18b

**Sources:** [Introducing dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) **2026-05-28**; [Workflows docs](https://code.claude.com/docs/en/workflows).

Verified:

- Workflows orchestrate many subagents via a script Claude writes; coordination can live outside the main conversation context.  
- First trigger shows plan and **asks confirmation** (high usage).  
- Docs: stop a run from `/workflows`; resume after pause keeps completed work (per docs).  
- Runtime **agent caps** bound runaway scripts.  
- **Large workflow** warning when scheduling >25 agents or projected tokens >1.5M (docs; version-gated).  
- Admins can disable workflows via managed settings.

**UNVERIFIED:** exact default max concurrent agents / numeric retry policy for individual tool failures outside workflow docs.

## 3. Cursor: plan gate, parallel work, verify signals — S23, S4, S5

**Sources:** [Agent best practices](https://cursor.com/blog/agent-best-practices) (S23, fetched 2026-08-02); [Scaling agents](https://cursor.com/blog/scaling-agents) (S4 ≈**2026-01-14**); [Swarm economics](https://cursor.com/blog/agent-swarm-model-economics) (S5 ≈ Jul 2026).

Verified product guidance (S23):

- Harness = instructions + tools + model; Cursor tunes per frontier model.  
- **Plan Mode:** research → clarifying questions → plan → **wait for approval** → build.  
- Prefer new conversation on task switch / confusion; long chats accumulate noise after summarizations.  
- Parallel agents via **git worktrees** (also S15 product docs).  
- “Provide verifiable goals”: typed languages, linters, tests.  
- Review carefully: speed increases need for human review.

Research (S4/S5 — not necessarily default product behaviour):

- Planner / worker / judge cycles; periodic **fresh starts** to combat drift (S4).  
- Known issues: agents occasionally run **far too long** (S4).  
- Swarm: impartial third-party agent for merge conflicts; frontier planner + cheap workers (S5).

## 4. GitHub Copilot (Jun–Jul 2026) — S24–S28

| Behaviour | Source | Date |
|-----------|--------|------|
| Discover tools/skills/MCP on demand; **do not auto-install** | [Agent finder](https://github.blog/changelog/2026-06-17-agent-finder-for-github-copilot-now-available/) (S25) | 2026-06-17 |
| Worktree isolation for Copilot, Claude, or Codex sessions | [VS Code July](https://github.blog/changelog/2026-07-30-github-copilot-in-visual-studio-code-july-2026-releases/) (S27) | 2026-07-30 |
| Track running subagents (model, elapsed, active tool) | same | 2026-07-30 |
| Code review MCP calls **read-only** | [CCR skills/MCP GA](https://github.blog/changelog/2026-07-29-copilot-code-review-agent-skills-and-mcp-now-generally-available/) (S26) | 2026-07-29 |
| New VS Agent (Preview) on Copilot SDK | [VS July](https://github.blog/changelog/2026-07-30-github-copilot-in-visual-studio-july-update/) (S28) | 2026-07-30 |
| Usage-based AI Credits (agentic cost) | [Billing](https://github.blog/changelog/2026-06-01-updates-to-github-copilot-billing-and-plans/) (S24) | 2026-06-01 |

**UNVERIFIED:** internal Copilot agent-loop source equivalent to OpenAI’s Jan 23 unroll.

## 5. Cross-vendor pattern summary (evidence-backed only)

| Concern | Convergent practice | Do not claim |
|---------|---------------------|--------------|
| Tool calling | Loop until model stops calling tools (S20) | A universal max-step product default |
| Retries | Failures fed back as tool/observation content; Ralph-style review loops (S3) | Specific N-retry defaults across vendors |
| Abort / pause | User stop; workflow stop; approval pause; stream cancel→resume from state | Identical semantics across products |
| Streaming | Incremental tokens; wait for stream settle before “done” | Identical event schemas |
| Context | Compaction + progressive disclosure (skills/MCP on demand) + short always-on maps | One compaction algorithm |
| Human gates | Plan approve, workflow confirm, permission/deny hooks, no silent install | HITL only at PR time |

## Gaps still UNVERIFIED after this pass

1. Exact publish date for Cursor Swarm Economics (S5) — page undated.  
2. Cursor Agent best practices (S23) first-publish date.  
3. OpenAI Agents SDK default max-turn / tool-retry numeric policies.  
4. Claude Code default tool-failure circuit-breaker numbers (if any) beyond hooks/workflows.  
5. August 2026-dated primary deep-dives beyond living docs / July changelogs.  
6. Internal harness details for GitHub Copilot agent loop comparable to Codex unroll (S20).
