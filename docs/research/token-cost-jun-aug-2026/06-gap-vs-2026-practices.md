# Gap vs 2026 practices → fix mapping

**Updated:** 2026-08-02 after Phase 1 practice refresh + Phase 2 code/AppData verification (`80bd4074`).  
Practice IDs from [`02-agent-context-engineering-practices.md`](./02-agent-context-engineering-practices.md).

| Practice | VYOTIQ today (Code) | Live evidence (`80bd4074`) | Gap | Status |
|----------|---------------------|----------------------------|-----|--------|
| P-LOOP / P-OBS — cumulative billed input | Receipt + meter use `billedInputTokens` / `peakInputTokens`; resume rebuilds from durable `step_usage` | Receipt Σ **4.72M** = event Σ (freeze) | — | **Closed** |
| P-OBS — per-step attribution | Parent (+ nested) emit `step_usage` with layers/hotspot | 151 steps with layers | Nested not in this receipt | **Closed** (parent) |
| P-COMPACT — soft hold after pressure | Soft-cap hold + pressure trim in `assembleContext` | Peak **47k** ≪ soft 64k; ≪ hist. 130k | — | **Closed** |
| P-TRIM — aggressive tool-result clearing | Keep last 2; under pressure 1; body caps; Anthropic `clear_tool_uses` with trigger + `clear_at_least` | History still grows but held | — | **Closed** (client + Anthropic server) |
| P-DEFER — budget / defer MCP | `TOOLS_SOFT_CAP` + `deferUnpinnedMcp` + idle TTL / soft max / `release_mcp_tools` | Tools ~6.7–8.1k; omit ×12 | — | **Closed** (defer + unload) |
| P-DEFER / P-NO-CHURN — pin recovery without breaking cache | Sticky restore + **append-admit** pins mid-run; last-used in `toolCatalog.json`; fail-fast on repeated not-in-catalog | `request_mcp_tools`×21+ + **not-in-catalog**×20; sticky catalog **0 MCP** (pre-fix sample) | Pins after lock unusable → wasted steps | **Closed** (code: sticky pin admit + fail-fast + unload) |
| P-PREFIX — stable cacheable prefix | Zones: stable lead + volatile trail; sticky fingerprint; GPT-5.6+ dual explicit breakpoints | Cache share **~74%** | Residual uncached = volatile (expected) | **Closed** |
| P-MSG-UPD — updates via messages | Volatile as trailing user message | — | — | **Closed** |
| Skill bodies out of durable history | Stub after open turn | — | — | **Closed** (code) |
| P-THINK — surface thinking cost | Reasoning totals + `token_cost_hint` + Think **Lower · {effort}** chip (click-only) | Reasoning **~130k**; long-run hints | No silent auto-downgrade (by design) | **Closed** (surface + suggest chip) |
| P-CLEAR — clear between tasks | `/clear` + tips + `long_run_task_boundary` hint (steps≥40 or billed≥1M) + ContextMeter tip | Single long run step **155** | Behavioral user choice remains | **Closed** (surface) |
| P-COMPACT — payback-gated LLM | `compactionPayback.ts` | Watermark only; **0** LLM compaction | — | **Closed** (gate worked) |
| P-HITRATE — treat hit rate as ops metric | Logs `cacheHitRateStep`; `low_cache_hit_rate` → composer `token_cost_hint` / `runNotice` | High hit rate this run | — | **Closed** (surface when &lt;10% on large steps) |
| P-NEST — nested attribution | Nested `step_usage` + panel | No nested in sample | Do not merge nested into parent meter | **Closed** (code) |

## Still-open gaps (implement later — not this engagement)

~~GPT-5.6+ extra breakpoints~~ — **Closed** (2026-08-02): second explicit breakpoint on last cacheable history item before volatile (skips `function_call_output`).

~~Anthropic context editing~~ — **Closed** (2026-08-02): `clear_tool_uses` with window-scaled `trigger` + `clear_at_least` 5k (Anthropic only; N/A for DeepSeek sample).

~~MCP pin unload~~ — **Closed** (2026-08-02): idle TTL / soft max / `release_mcp_tools` + last-used persistence; see [`09`](./09-tool-catalog-lifecycle.md).

~~Thinking cost controls~~ — **Closed** (2026-08-02): Think **Lower · {effort}** chip when high/xhigh/max and steps≥10; click steps down one allowed effort; dismissible; never silent auto-downgrade.

~~Sticky vs pin admission~~ — **Closed** (2026-08-02): sticky catalogs append-admit `request_mcp_tools` pins without reshuffling prior order; repeated same-tool not-in-catalog errors fail-fast (threshold 2) with loop hint.

~~P-CLEAR surfacing~~ — **Closed** (2026-08-02): `long_run_task_boundary` token_cost_hint + ContextMeter tip when steps≥40 or billed input≥1M.

## Explicit non-fixes

- Hard max agent / subagent steps  
- Redis / semantic answer caches  
- Silently lowering user thinking effort  
- Rolling nested billed tokens into the parent ContextMeter  
- Blind adoption of secondary “60–90% cheaper” claims without usage-field proof  

## Regression note

Gaps marked “closed” for soft-cap / billed telemetry / cache zones are **verified against `80bd4074`**. Do not reopen them from the historical `1f175050` appendix alone.
