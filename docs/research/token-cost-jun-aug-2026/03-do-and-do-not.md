# Do and do-not (token cost)

**Sources:** T1–T8, T13. Short checklist for implementers.  
**Refresh:** 2026-08-02.

## Do

1. **Sum step inputs** for run cost; keep “latest window size” as a separate field (P-LOOP, P-OBS).
2. **Stable prefix** — harness/rules/tools first; volatile session data last (P-PREFIX).
3. **Trim tool results** aggressively; keep last few full bodies only (P-TRIM).
4. **Compact early enough** and verify post-compact estimate ≤ soft trigger; prefer cache-safe compaction forks (P-COMPACT).
5. **Budget / defer tool defs**; shed optional/MCP via stubs, not mid-run deletes; keep pin/recovery path (P-DEFER).
6. **Log structured cost** per step and run (layers, hotspot, cacheReported) (P-OBS).
7. **Warn** when context ≫ soft trigger after compaction, or cache hit rate stays tiny on large inputs (P-HITRATE).
8. **Surface reasoning tokens** when thinking is on (P-THINK).
9. **Clear between unrelated tasks** (`/clear` / new chat) (P-CLEAR).
10. **Push live updates via messages** instead of editing the stable system mid-run (P-MSG-UPD).

## Do not

1. Treat receipt “latest input” as total spend.
2. Put timestamps / session IDs in the stable system prefix.
3. Reshuffle tool JSON every step without a catalog change.
4. Add Redis / semantic answer caches “for cost” without an approved design.
5. Invent hard max-step kill switches.
6. Silently lower thinking effort to save money.
7. Log request bodies, API keys, or full message text in cost logs.
8. Assume every OpenAI-compat host reports cache fields — log absence explicitly.
9. Adopt secondary “60–90% cheaper” blog claims without provider usage-field proof on *this* harness.
10. Freeze USD from outdated news posts (e.g. DeepSeek launch prices) into product math.

---

## Do-not-adopt-blindly (secondary / marketing)

These appear often in blogs and social posts. **Do not** treat them as implementation requirements unless a **Verified primary** + measured VYOTIQ evidence supports them.

| Claim pattern | Why reject / downgrade | Prefer instead |
|---------------|------------------------|----------------|
| “Prompt caching cuts cost 60–90%” as a blanket guarantee | Hit rates and discounts are provider- and prefix-specific; DeepSeek/Claude marketing numbers are not transferable | Meter `cached_*` / `prompt_cache_hit_*` on real runs; cite live pricing only when computing USD |
| Static USD tables copied from launch posts | Prices change; T7 news USD is explicitly historical | Link Models & Pricing; leave USD out of audits unless citing a dated price page |
| Redis / semantic caches of tool answers as the cost fix | Different problem (memoization vs prompt prefix); security + staleness; out of this pack’s scope | Stable prefix + trim + defer tools + clear sessions |
| Hard agent / subagent **step caps** as cost control | Conflicts with project rule; kills long valid tasks; not a caching practice | Soft context hold, user abort, `/clear`, fail-fast on repeated tool errors |
| “Just remove unused tools mid-turn” | Mid-session tool catalog churn busts prefix cache (T8, T13) | `defer_loading`-style stubs + on-demand schema fetch |
| “Switch to a cheaper model mid-chat to save money” | Cache rebuild on new model can cost more than staying (T13) | Subagent handoff with cheap worker, or new session |
| Invented “expected savings %” without A/B on same task | Anecdote; confounds model/task/history length | Offline benchmarks on receipts + labeled counterfactual math (Phase 3) |

**Rule of thumb:** If a recommendation does not cite a primary ID (T1–T8, T13) *and* a measurable usage field or context-layer estimate, mark it **secondary / reject until proven**.
