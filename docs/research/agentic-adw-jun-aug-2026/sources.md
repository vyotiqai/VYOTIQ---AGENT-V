# Sources & bibliography

**Compiled:** 2026-08-01 · **Extended:** 2026-08-02  
**Authoritative IDs:** [`00-source-inventory.md`](./00-source-inventory.md) · integrity: [`10-source-integrity.md`](./10-source-integrity.md)

## Primary — ADW framing

| ID | Source | Date | Use |
|----|--------|------|-----|
| S1 | [`_source-indydevdan-forget-loop-engineering.txt`](./_source-indydevdan-forget-loop-engineering.txt) | ≈ 2026-07-13 | Three actors; ADW > loop engineering |
| S2 | [OpenClawDatabase ADW analysis](https://openclawdatabase.com/news/videos/2026-07-13-ai-developer-workflows/) | 2026-07-13 | Secondary corroboration of S1 |
| — | [YouTube primary](https://www.youtube.com/watch?v=VQy50fuxI34) | ≈ 2026-07-13 | Video ID matched to S1/S2 |

## Primary — lab / protocol (dated)

| ID | Source | Date | Use |
|----|--------|------|-----|
| S3 | [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/) | 2026-02-11 | AGENTS.md TOC; mechanical docs/CI; worktrees; agent review; merge philosophy |
| S4 | [Cursor — Scaling agents](https://cursor.com/blog/scaling-agents) | 2026-01-14 | Planner/worker/judge; remove integrator; model-per-role |
| S5 | [Cursor — Agent swarm economics](https://cursor.com/blog/agent-swarm-model-economics) | **2026-07-20** (related-strip; page undated) | Tree roles; cost; review lenses; Field Guide |
| S6 | [Claude — Large codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start) | 2026-05-14 | Layering CLAUDE.md→hooks→skills→plugins→MCP |
| S6b | [Claude Code — Large codebases docs](https://code.claude.com/docs/en/large-codebases) | live | Nested memory; sparsePaths; worktree settings |
| S9 | [Cursor — Agent sandboxing](https://cursor.com/blog/agent-sandboxing) | 2026-02-18 | OS sandboxes; approval fatigue |
| S11 | [Anthropic — AI-native SDLC security](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle) | **2026-07-21** | Deterministic + agentic reviews |
| S12 | [MCP Authorization Security Considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) | **2026-07-28** | OAuth 2.1; resource; audience; no passthrough |
| S18 | [Steering Claude Code](https://claude.com/blog/steering-claude-code-skills-hooks-rules-subagents-and-more) | **2026-06-18** | Seven methods; hooks vs skills; compaction |
| S19 | [Introducing dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code) | **2026-05-28** | Orchestration scripts; confirm gate |
| S20 | [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) | **2026-01-23** | Canonical tool loop; streaming; compaction |
| S21 | [Unlocking the Codex harness](https://openai.com/index/unlocking-the-codex-harness/) | **2026-02-04** | App Server; approval pause |
| S24 | [Copilot billing changelog](https://github.blog/changelog/2026-06-01-updates-to-github-copilot-billing-and-plans/) | **2026-06-01** | AI Credits |
| S25 | [Agent finder](https://github.blog/changelog/2026-06-17-agent-finder-for-github-copilot-now-available/) | **2026-06-17** | On-demand discovery; no auto-install |
| S26 | [CCR skills/MCP GA](https://github.blog/changelog/2026-07-29-copilot-code-review-agent-skills-and-mcp-now-generally-available/) | **2026-07-29** | Review skills; MCP read-only |
| S27 | [VS Code July 2026](https://github.blog/changelog/2026-07-30-github-copilot-in-visual-studio-code-july-2026-releases/) | **2026-07-30** | Worktrees; subagent tracking |
| S28 | [Visual Studio July](https://github.blog/changelog/2026-07-30-github-copilot-in-visual-studio-july-update/) | **2026-07-30** | Agent (Preview) on SDK |
| S29 | [Session management / 1M context](https://claude.com/blog/using-claude-code-session-management-and-1m-context) | **2026-04-15** | Compaction / context rot |

## Primary — product docs (fetched 2026-08-02)

| ID | Source | Use |
|----|--------|-----|
| S10 | [Claude Code — Memory](https://code.claude.com/docs/en/memory) | Context ≠ enforcement; AGENTS.md import |
| S13 | [Claude Code — Permissions](https://code.claude.com/docs/en/permissions) | deny/ask/allow; modes; MCP tool rules |
| S14 | [Hooks guide](https://code.claude.com/docs/en/hooks-guide) · [Hooks reference](https://code.claude.com/docs/en/hooks) | Lifecycle; exit 2; format/guard |
| S15 | [Cursor — Worktrees](https://cursor.com/docs/configuration/worktrees) | Product worktree isolation; /best-of-n |
| S16 | [Claude — Worktrees](https://code.claude.com/docs/en/worktrees) · [Agents](https://code.claude.com/docs/en/agents) · [Sub-agents](https://code.claude.com/docs/en/sub-agents) | Parallel + `isolation: worktree` |
| S18b | [Claude — Workflows](https://code.claude.com/docs/en/workflows) | Caps; pause/resume; Large workflow warning |
| S22 | [OpenAI — Compaction](https://developers.openai.com/api/docs/guides/compaction) | Server-side + `/responses/compact` |
| S23 | [Cursor — Agent best practices](https://cursor.com/blog/agent-best-practices) | Plan Mode; context; verifiable goals |
| — | [Cursor — Agent computer use](https://cursor.com/blog/agent-computer-use) | **2026-02-24** — cloud VM + computer use |
| — | [Cursor — Self-driving codebases](https://cursor.com/blog/self-driving-codebases) | ≈ Jan–Feb 2026 — research planner/worker depth |
| — | [Cursor — Cloud agent lessons](https://cursor.com/blog/cloud-agent-lessons) | ≈ late Jul 2026 — env as product; durable runs |
| — | [Cursor changelog — Cloud Agents with Computer Use](https://cursor.com/changelog/02-24-26) | Dates computer-use launch |
| — | [OpenAI — Running agents](https://developers.openai.com/api/docs/guides/agents/running-agents) | Loop outline; stream cancel/resume (**REACHABLE** 2026-08-02) |

## Secondary / directional

| Source | Date | Caveat |
|--------|------|--------|
| [spec-agent](https://marcusviniciusbarcelos.github.io/spec-agent/) | 2026 | Stop-hook gate product — not lab-endorsed |
| [pi-gate](https://github.com/renezander030/pi-gate), [make-no-mistakes](https://github.com/visneto-aitest/make-no-mistakes) | 2026 | Isolated/tamper-resistant gates — directional |
| [Rohit Raj — Harness notes](https://rohitraj.tech/en/notes/what-is-harness-engineering-codex-2026) | 2026 | Echoes S3; warns against copying loose merge gates |
| [Coalition for Secure AI — MCP Security PDF](https://www.coalitionforsecureai.org/wp-content/uploads/2026/03/model-context-protocol-security-1.pdf) | 2026-03 | Allowlists, supply chain — secondary |
| localskills / MCP.Directory CLAUDE vs AGENTS vs Skills | 2026 | Taxonomy useful; eval claims **UNVERIFIED** here |

## Internal

| Source | Use |
|--------|-----|
| `docs/architecture.md` | Modes, intentional soft gates |
| `docs/harness-handbook.md` | Harness operator map |
| `docs/research/04-best-practices-patterns.md` | Cross-link |
| `src/main/agent/**` | Runtime ground truth for mapping docs |

## Dating corroboration

| Source | Use |
|--------|-----|
| [Simon Willison — Scaling long-running autonomous coding](https://simonwillison.net/2026/jan/19/scaling-long-running-autonomous-coding/) | Corroborates S4 publish window (Jan 2026) |

## Explicitly de-prioritized

Hype “loop engineering guide” blogs that contradict ADW three-actor framing or lack primary lab backing — do not code against. Tertiary SEO roundups are not bibliography entries. Prefer IDs in [`00-source-inventory.md`](./00-source-inventory.md); when citing tool-loop behaviour use URL+date from S18–S29 / [`11-tool-use-loop-behaviours.md`](./11-tool-use-loop-behaviours.md).
