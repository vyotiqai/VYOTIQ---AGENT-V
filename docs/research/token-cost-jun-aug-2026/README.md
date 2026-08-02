# Token cost & context burn (Jun–Aug 2026)

**Research window:** Provider cost / caching / context-engineering contracts as of 2026-08-02.  
**Compiled:** 2026-08-02  
**Freeze status:** Phases 1–4 complete. Practices refreshed; audit + offline benchmarks on live session `80bd4074` (freeze Σ billed **4.72M**, peak **47,049**, cache **~74%**). **No product code changes** in this engagement.  
**Thesis:** Agent cost is dominated by **Σ input tokens across steps**, not a single “context meter.” Fixes are architectural (history pressure, compaction hold, tool-schema tax, cache-prefix stability, truthful cumulative telemetry) and are **provider-agnostic**.

## How to read

1. [`00-source-inventory.md`](./00-source-inventory.md) — primaries, confidence, conflicts  
2. [`_source-snapshot-notes-2026-08-02.txt`](./_source-snapshot-notes-2026-08-02.txt) — re-fetch log vs prior freeze  
3. [`01-provider-cost-and-caching-2026.md`](./01-provider-cost-and-caching-2026.md) — common rules + per-provider contracts  
4. [`02-agent-context-engineering-practices.md`](./02-agent-context-engineering-practices.md) — long-horizon agent patterns (+ practice IDs)  
5. [`03-do-and-do-not.md`](./03-do-and-do-not.md) — short checklist + **do-not-adopt-blindly**  
6. [`04-vyotiq-token-burn-audit.md`](./04-vyotiq-token-burn-audit.md) — VYOTIQ root causes (Code + AppData)  
7. [`05-run-telemetry-case-study.md`](./05-run-telemetry-case-study.md) — measured run `80bd4074` (+ historical appendix)  
8. [`06-gap-vs-2026-practices.md`](./06-gap-vs-2026-practices.md) — practice → gap → fix mapping  
9. [`07-benchmark-results.md`](./07-benchmark-results.md) — offline + synthetic benchmarks  
10. [`08-reduction-recommendations.md`](./08-reduction-recommendations.md) — ranked levers (**implement later**)  
11. [`09-tool-catalog-lifecycle.md`](./09-tool-catalog-lifecycle.md) — stay vs drop + idle TTL / `release_mcp_tools`  
12. [`sources.md`](./sources.md) — bibliography  
13. [`benchmarks/`](./benchmarks/) — parser + saved JSON artifacts  

## Executive snapshot (AppData `80bd4074` freeze)

| Metric | Value |
|--------|------:|
| Σ billed input | **4,721,077** |
| Peak input | **47,049** |
| Cache share of billed input | **~74%** |
| Reasoning Σ | **130,255** |
| Compaction LLM events | **0** (trim watermark only) |
| Not-in-catalog MCP fails (parser) | **20** |
| Top remaining defect | Sticky freeze blocks mid-run MCP pins |

## Related packs (do not duplicate)

- [`../caching-jun-aug-2026/`](../caching-jun-aug-2026/) — existing cache inventory  
- [`../thinking-effort-jun-aug-2026/`](../thinking-effort-jun-aug-2026/) — effort contracts  
- [`../agentic-adw-jun-aug-2026/11-tool-use-loop-behaviours.md`](../agentic-adw-jun-aug-2026/11-tool-use-loop-behaviours.md) — loop behaviours  
- [`../04-best-practices-patterns.md`](../04-best-practices-patterns.md) §2–4  

## Integrity

- Prefer official docs over blogs.  
- Labels: **Verified primary** · **Verified secondary** · **Code** · **AppData evidence** · **Estimate**.  
- Code wins when research disagrees with `src/`.  
- Log and meter **tokens**; do not invent USD without a cited price table.  
- Reject secondary 60–90% claims, Redis “cost caches,” and hard step caps ([`03-do-and-do-not.md`](./03-do-and-do-not.md)).
