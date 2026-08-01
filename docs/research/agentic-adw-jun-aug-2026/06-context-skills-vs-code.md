# Context, skills vs code

**Research pass:** 2026-08-02  
**Sources:** S3, S6, S6b, S10 (memory), S11 (SDLC).

## Progressive disclosure (Verified primary)

### OpenAI (2026-02-11)

[Harness engineering](https://openai.com/index/harness-engineering/):

- Giant single `AGENTS.md` **failed**: context scarcity, “everything important = nothing important,” instant rot, hard to verify mechanically.  
- Pattern: **~100-line AGENTS.md as table of contents** → structured `docs/` as system of record (design docs, exec plans, generated schema, quality grades, etc.).  
- **Mechanical linters + CI** validate knowledge base; doc-gardening agent opens fix PRs.  
- Plans are first-class versioned artifacts (`docs/exec-plans/…`).  
- Anything not in the repo is **illegible** to the agent (Slack/docs-in-heads ≈ missing).

### Anthropic Claude Code (2026-05-14 + docs)

[Large codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start) + [memory](https://code.claude.com/docs/en/memory):

- Root CLAUDE.md: **pointers + critical gotchas**; subdirectory CLAUDE.md for local conventions (additive load).  
- Prefer init **in subdirectory** for monorepos; Claude walks up and still loads root.  
- Skills: progressive disclosure; path-scoped skills so payments deploy skill doesn’t load elsewhere.  
- `.ignore` / `permissions.deny` for noise reduction — version-controlled.  
- Review CLAUDE.md/skills/hooks every **3–6 months** and after model leaps — old constraints can hurt newer models.  
- Explicit: CLAUDE.md / auto memory are **context, not enforced configuration**. To **block** regardless of model decision → **PreToolUse hook** / permissions.

Claude does **not** natively read `AGENTS.md`; documented pattern: `CLAUDE.md` that `@`-imports `AGENTS.md` so multi-tool repos share one map ([memory](https://code.claude.com/docs/en/memory)).

## Skills vs rules vs code

| Put in always-on map (AGENTS.md / CLAUDE.md / short rules) | Put in skills | Put in **code** (hooks, CI, linters, permissions, sandbox) |
|-----------------------------------------------------------|---------------|------------------------------------------------------------|
| Build/test command pointers | Multi-step SOPs | Lint/type/test gates |
| Architecture map + links to `docs/` | Domain playbooks (security review, migrations) | Path sandbox / deny lists |
| “Always do X” one-liners that must be present | Optional checklists | Mode allowlists; apply confirm |
| Ownership / where to look | Bundled scripts + references | Anything that must **never** be skippable |

Anti-pattern: “productionized” workflow still living **only** inside one skill or one mega-memory file (S1 ADW; S3/S6).

Anthropic Security (2026-07-21): secure-coding guidelines encoded in CLAUDE.md + org skills; closed loop updates those files when a bug class is found — **prevention at generation**, still paired with review/CI ([SDLC](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)).

## Skills vs always-on — contested evidence

Secondary 2026 writeups cite evals where **always-on compressed docs in AGENTS.md** beat skills that were never triggered (e.g. Vercel agent evals narrative on MCP.Directory / localskills blogs).  

**Status:** **Verified secondary** (not re-run here). Implication if true: critical invariants → always-on map **and** code; skills for heavy/rare procedures. Do not delete skills based on blog alone — verify with your harness evals.

## Cursor rules / harness prompts

Cursor scaling post: coordination quality depended heavily on **prompting** agents ([Scaling agents](https://cursor.com/blog/scaling-agents)). Product also ships `.cursor/rules`, skills, worktree setup — treat rules like CLAUDE.md: short, scoped; enforce via sandbox/permissions/CI.

## Compaction / durable memory

Long runs need state **outside** the window:

| Lab pattern | Artifact |
|-------------|----------|
| OpenAI | Checked-in plans, docs, quality grades, agent-written Field Guide–like institutionalization (Cursor swarm Field Guide is research analog) |
| Claude | CLAUDE.md + auto memory (first N lines/size cap) + path rules; subagent auto memory optional |
| Cursor swarm | Agent-owned Field Guide with line budget injected at start ([swarm economics](https://cursor.com/blog/agent-swarm-model-economics)) |

VYOTIQ preview: run dirs, compaction, `.vyotiq/memory`, harness review mining — agentic-layer persistence without RAG. Aligns with “repo/files as SoR.”

## Enforcement ladder (dense)

```
must never skip  →  code (hooks, CI, permissions, sandbox)
should usually   →  short always-on map + link to docs
sometimes / long →  skill (progressive disclosure)
judgment / taste →  engineer review + agent reviewers
```

Promote: when a prompt fails twice → encode in CLAUDE.md/AGENTS.md; when that still fails → **hook/linter**. OpenAI: “When documentation falls short, we promote the rule into code.”
