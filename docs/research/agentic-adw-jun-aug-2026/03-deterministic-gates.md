# Deterministic gates

**Research pass:** 2026-08-02 (extends 2026-08-01 package)  
**Sources:** S3, S6, S10, S11, S14 (hooks), S17 (secondary community gates). Cite URLs in body.

## Verified pattern (primary)

Production agent systems treat **lint / format / typecheck / tests / structural rules** as **code** that always runs — not as skill epilogues the model may skip.

| Mechanism | Who runs it | Guarantee | Primary cite |
|-----------|-------------|-----------|--------------|
| Custom linters + structural tests | CI / local harness | Architecture edges, naming, file-size, logging invariants | OpenAI [Harness engineering](https://openai.com/index/harness-engineering/) (2026-02-11) |
| Doc / knowledge-base CI | CI + “doc-gardening” agent | Cross-links, structure, freshness mechanically checked | Same |
| Hook after edit / before stop | Host (Claude Code hooks) | Format/lint run every matched event; exit semantics feed model | [Hooks guide](https://code.claude.com/docs/en/hooks-guide); [large-codebases blog](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start) (2026-05-14) |
| In-session + PR security review | Plugin / command + humans | Deterministic *and* agentic review layered before/after prod | Anthropic [AI-native SDLC](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle) (2026-07-21) |
| CI as acceptance signal | Repo CI | Long-running agent work judged by “passing CI / early checks” | Cursor [Scaling agents](https://cursor.com/blog/scaling-agents) |

## Loop shape that labs describe

1. Agent edits.  
2. **Code** gate fails → structured error (often written for agent remediation) returns into the **same** session.  
3. Gate passes → advance (more gates, review agent, engineer, merge).  

OpenAI: lint error messages are authored to **inject remediation instructions into agent context**; when docs fail, promote the rule **into code** ([Harness engineering](https://openai.com/index/harness-engineering/)).

Claude: “For automated checks like linting and formatting, **hooks enforce the rules deterministically** and produce more consistent results than relying on Claude to remember an instruction” ([large-codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start), 2026-05-14). Official docs: CLAUDE.md is **context, not enforced configuration**; blocking requires hooks/permissions ([memory](https://code.claude.com/docs/en/memory)).

Anthropic Security (2026-07-21): combine **automated deterministic and agentic reviews**; encode secure-coding guidance in CLAUDE.md / skills, but treat that as prevention at generation time — not a substitute for review/CI ([SDLC post](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle)).

## Subdirectory scoping of checks

Claude large-codebase guidance: scope **test and lint commands per subdirectory**; full-suite runs on a one-service change waste context and time out ([large-codebases](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start)).

## Merge-gate philosophy — conflict

OpenAI agent-first repo: **minimal blocking merge gates**, short-lived PRs, flakes often fixed forward — because “corrections are cheap, waiting is expensive” at agent throughput ([Harness engineering](https://openai.com/index/harness-engineering/)). Same article: “This would be irresponsible in a low-throughput environment.”

**Conflict — do not code against blindly:** high-throughput OpenAI merge looseness ≠ default for small/product teams. Prefer copying **mechanical gates + agent-readable errors + review loops** before copying loose merge policy. Secondary commentary (Rohit Raj, 2026) makes the same warning explicitly — treat as **Verified secondary**.

## Review as a gate (not only tests)

| Lab | Pattern | Cite |
|-----|---------|------|
| OpenAI | Agent self-review + local/cloud agent reviewers until satisfied; humans optional at high confidence | [Harness engineering](https://openai.com/index/harness-engineering/) |
| Cursor swarm research | Stacked “review lenses” (different context/models); review compute high ROI | [Agent swarm economics](https://cursor.com/blog/agent-swarm-model-economics) |
| Anthropic | `/security-review` / security-guidance plugin during generation; humans at high-leverage approvals | [AI-native SDLC](https://claude.com/blog/how-anthropic-secures-its-ai-native-software-development-lifecycle) (2026-07-21) |

## Held-out / anti-gaming

- Cursor swarm eval used a **held-out SQL test suite** comparing swarm versions ([Agent swarm economics](https://cursor.com/blog/agent-swarm-model-economics)).  
- OpenAI treats **evaluation harnesses** as first-class repo artifacts ([Harness engineering](https://openai.com/index/harness-engineering/)).  
- Community harnesses (spec-agent Stop-hook gates; pi-gate isolated clone + network-off checks; make-no-mistakes tamper/mutation) — **Verified secondary / Directional only**; not lab-endorsed. Useful as existence proof that “done = verified” is productized outside labs.

## Anti-patterns (verified by negation)

| Anti-pattern | Why it fails | Cite |
|--------------|--------------|------|
| Giant skill: “run build then lint then test” | Agent still decides whether to run | S6 hooks vs skills; ADW S1 |
| Rely solely on AGENTS.md / CLAUDE.md “always verify” | Context, not enforcement | [memory](https://code.claude.com/docs/en/memory) |
| Trust implementer-owned tests alone | Agents can weaken/delete tests | Secondary (make-no-mistakes / pi-gate claims) — **UNVERIFIED** as universal law; treat as risk hypothesis |

## VYOTIQ note (preview only — no product change)

Diagnostics tool exists; no automatic post-edit re-entry gate. Soft read-before-edit warnings exist. Hard verify-before-done intentionally absent per architecture — **Conflict** with pure ADW “code gate” advice; do not silently hard-stop without product decision. `HARNESS_EVAL_TESTS` aligns with held-out evaluator idea.
