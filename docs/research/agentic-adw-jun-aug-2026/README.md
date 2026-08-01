# AI Developer Workflows research (Jun–Aug 2026)

**Research window:** ADW framing ≈ Jul 2026; lab practices = still-governing Jan–May 2026 primaries + in-window Jun–Jul docs (not “all claims published Jun–Aug”).  
**Compiled:** 2026-08-01 · **Extended:** 2026-08-02  
**Freeze status:** **YES — freeze-ready** (2026-08-02). Caveats + checklist: [`10-source-integrity.md`](./10-source-integrity.md). Documentation only; does not change product behavior.

## Thesis

The unit of agentic work is an **AI Developer Workflow (ADW)** — plan → build → validate → review → ship — executed by three actors: **engineers**, **agents**, and **code**. “Loop engineering” names only the fail→retry edge; it is not the whole system.

Reliability ranking (most → least): **code** (deterministic, zero tokens) → **engineers** (plan + review constraints) → **agents** (specialized workers). Prefer mechanical gates over prompt/skill hope.

Framing source: IndyDevDan / OpenClaw (S1/S2). Lab products use “harness,” hooks, Plan Mode, etc. — mapped in [02](./02-landscape-jun-aug-2026.md).

## How to read

1. [00-source-inventory.md](./00-source-inventory.md) — what was fetched, confidence, conflicts, ID map  
2. [01-adw-thesis-and-actors.md](./01-adw-thesis-and-actors.md) — three actors, human gates, agentic vs app layer  
3. [02-landscape-jun-aug-2026.md](./02-landscape-jun-aug-2026.md) — dated lab timeline vs ADW vocabulary  
4. [03-deterministic-gates.md](./03-deterministic-gates.md) — lint/type/test as code  
5. [04-tools-mcp-hooks.md](./04-tools-mcp-hooks.md) — tools, MCP, hooks  
6. [05-orchestration-and-isolation.md](./05-orchestration-and-isolation.md) — roles, worktrees, sandboxes  
7. [06-context-skills-vs-code.md](./06-context-skills-vs-code.md) — skills = knowledge; code = enforcement  
8. [07-vyotiq-mapping.md](./07-vyotiq-mapping.md) — Have / Partial / Missing on this repo  
9. [08-audit-findings.md](./08-audit-findings.md) — ranked, evidence-backed gaps  
10. [09-e2e-verification.md](./09-e2e-verification.md) — E2E commands and results  
11. [10-source-integrity.md](./10-source-integrity.md) — **source integrity / freeze readiness** (read before freeze)  
12. [11-tool-use-loop-behaviours.md](./11-tool-use-loop-behaviours.md) — tool calling, abort, streaming, compaction (2026-08-02)  
13. [sources.md](./sources.md) — annotated bibliography  

Local transcript artifact: [`_source-indydevdan-forget-loop-engineering.txt`](./_source-indydevdan-forget-loop-engineering.txt)

## Integrity rules

- Prefer **official lab docs** (OpenAI, Anthropic/Claude, Cursor, MCP) with **explicit dates** over SEO blogs. Jun–Aug is the ADW-framing window, not a claim every lab essay was published then.  
- Label claims: **Verified primary** · **Verified secondary** · **Date inferred** · **UNVERIFIED** · **Conflict — do not code against**.  
- Transcript marketing CTAs are not technical claims.  
- Code over stale research docs when they disagree.  
- Before freezing: [`10-source-integrity.md`](./10-source-integrity.md).

## Related

- Broader research index: [../README.md](../README.md)  
- Architecture: [../../architecture.md](../../architecture.md)  
- Harness handbook: [../../harness-handbook.md](../../harness-handbook.md)
