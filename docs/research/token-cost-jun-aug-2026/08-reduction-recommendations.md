# Reduction recommendations

**Date:** 2026-08-02 · Phase 4 (+ unload / cache polish)  
**Inputs:** Phase 1 practice IDs · Phase 2 audit · Phase 3 benchmarks (`80bd4074` freeze).  
**Related:** [`09-tool-catalog-lifecycle.md`](./09-tool-catalog-lifecycle.md)

## Ranked levers

| Rank | Lever | Preserve capability how | Practice IDs | Metric (AppData / Estimate) | Status |
|-----:|-------|-------------------------|--------------|-----------------------------|--------|
| 1 | **Fix MCP pin × sticky freeze** — admit pins into sticky *before* freeze, or explicit re-lock; **fail-fast** on repeated “not in catalog” instead of N retries | Same MCP tools when needed; fewer failed round-trips | P-DEFER, P-NO-CHURN, P-LOOP | not-in-catalog **20**; failed tools **46**; est. **0.64–1.47M** gross input | **Shipped** (append-admit + fail-fast) |
| 1b | **Unload pinned MCP when idle** — idle TTL + soft max + `release_mcp_tools`; persist last-used in `toolCatalog.json`; log `Evicted idle/excess pinned MCP` (`TOKEN_COST`) | Re-pin anytime; required builtins never shed | P-DEFER, P-NO-CHURN | Schema tokens no longer immortal for the run | **Shipped** (see [`09`](./09-tool-catalog-lifecycle.md)) |
| 2 | **Keep soft-cap hold** — never regress hold trim / payback skip | Same task continuity; peak stays ≪ 130k | P-COMPACT, P-TRIM | Peak **47,049** vs hist. ~130k; counterfactual same-steps @130k ≈ **+14.9M** | **Protect + regression tests** |
| 3 | **Maintain cache prefix hygiene** — sticky fingerprint, stable/volatile zones; GPT-5.6+ **two** explicit breakpoints (stable system + last history before volatile) | Same answers; lower uncached input | P-PREFIX, P-HITRATE, P-MSG-UPD | Cache share **~74%** vs hist. ~2.8% | **Shipped** (zones + extra BP) |
| 4 | **Surface thinking cost; optional user-controlled effort** — keep hints; never silent downgrade | User choice preserved | P-THINK, P-OBS | Reasoning **~130k**; hints on long runs | **Shipped** (hints + Think title + **Lower** chip) |
| 5 | **Task-boundary `/clear` UX** — prompt when billed Σ or steps cross thresholds | No quality change mid-task | P-CLEAR | Single chat step **155** / Σ **4.72M** | **Shipped** (`long_run_task_boundary` + meter tip) |
| 6 | **Verify compaction payback stays gated** — watermark ≠ LLM count | Avoid unpaid summarize calls | P-COMPACT | Watermark present; **0** LLM compaction events | **Protect (working)** |
| 7 | **Anthropic server `clear_tool_uses`** — `trigger` + `clear_at_least` (5k) so clears do not thrash prompt cache | Client trim still primary; server clears large stale tool bodies | P-TRIM | N/A on DeepSeek sample | **Shipped** (Anthropic only) |

## Explicit non-recommendations

| Idea | Why not |
|------|---------|
| Hard max agent/subagent steps | Project rule; kills valid long tasks |
| Redis / semantic answer caches | Out of scope; not a prompt-prefix fix ([`03`](./03-do-and-do-not.md)) |
| Blind “60–90% cheaper” blog targets | Secondary; require usage-field A/B |
| Silently lower thinking | Violates P-THINK / user agency |
| Always send full MCP schemas | Synthetic shows **+7–8k**/step vs builtins; fights P-DEFER |
| Breakpoint on `function_call_output` | Accepted by API but does not write cache (OpenAI Reports GA notes) |

## Suggested follow-on implementation order (when approved)

1. ~~Sticky/pin admission + fail-fast (rank 1)~~ — **done**.  
2. ~~Regression tests that soft-cap peak and billed Σ semantics cannot regress (rank 2–3)~~ — **done** (`tokenCostRegression.invariants.test.ts`).  
3. ~~Composer/UX: clearer `/clear` + thinking cost surfacing (ranks 4–5)~~ — **done** (`long_run_task_boundary` + ContextMeter tip; Think title cost note; **Lower · {effort}** chip on high effort @ steps≥10).  
4. ~~MCP unload + last-used persist + eviction `TOKEN_COST` log (rank 1b)~~ — **done**.  
5. ~~GPT-5.6+ trailing history breakpoint + Anthropic `clear_at_least` / trigger (ranks 3, 7)~~ — **done**.

Still optional later: A/B `clear_at_least` vs observed `cache_creation`; re-tune TTL after eviction logs accumulate on post-unload builds.

**AppData TTL note (2026-08-02):** `80bd4074` was read/terminal-heavy (101× read, 96× terminal) with sparse MCP invokes → raised `MCP_PIN_IDLE_TTL_STEPS` **8 → 16** to avoid re-pin/cache thrash; soft max stays **12**.
