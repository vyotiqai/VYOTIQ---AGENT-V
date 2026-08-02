# Provider cost & caching (2026) — common rules first

**Sources:** T1–T8, T13 (primaries). Details that differ by lab are secondary to the **shared** agent economics below.  
**Refresh:** 2026-08-02 — see [`_source-snapshot-notes-2026-08-02.txt`](./_source-snapshot-notes-2026-08-02.txt).

## Common rules (any provider)

1. **Agent cost ≈ Σ(input tokens per step) + Σ(output/reasoning)** — each tool round re-sends the assembled prompt (T5, T8, T9, T13).
2. **Stable prefix first** — system instructions, tool definitions, reference docs at the start; dynamic content (user turn, tool results, timestamps) last (T1, T2, T7, T8, T13).
3. **Exact prefix match** — byte/token changes early in the prompt bust the cacheable prefix (T1, T2, T7, T8, T13).
4. **Meter hits from usage fields** — do not invent hit rates client-side (T1 `cached_tokens` / `cache_write_tokens`; T2 `cache_read_input_tokens` / `cache_creation_input_tokens`; T6 cached content counts; T7 `prompt_cache_hit_tokens`).
5. **Clear or compact deliberately** — long sessions without clearing re-bill large prefixes every step (T5). Compaction itself is a billable request (T5, T13).
6. **Thinking/effort is paid output** — higher effort increases reasoning tokens on every step (T5; see thinking pack).
7. **Do not add/remove tools mid-session** — change the tool catalog only when the catalog actually changed; prefer defer stubs over delete (T8, T13).

## OpenAI (T1)

| Mechanic | Contract |
|----------|----------|
| Implicit caching | Eligible prompts (~≥1024 tokens) auto-match prefixes |
| `prompt_cache_key` | Routes related requests; **required** for reliable GPT-5.6+ matching |
| Explicit breakpoints | GPT-5.6+: `prompt_cache_breakpoint` at end of reusable prefix; TTL currently `30m` |
| Cache policy | `prompt_cache_options.mode`: `implicit` (default) or `explicit` (only your breakpoints) |
| Writes | Pre-GPT-5.6: no extra write fee. GPT-5.6+: writes billed **1.25×** uncached input (`cache_write_tokens`) |
| Usage | `cached_tokens` (reads); `cache_write_tokens` (writes on GPT-5.6+) |

**Practice implication:** On GPT-5.6+, place an explicit breakpoint after the stable system+tools prefix so volatile history does not sit under an implicit breakpoint that rewrites the whole prefix every step.

## Anthropic (T2, T3, T4, T13)

| Mechanic | Contract |
|----------|----------|
| `cache_control` | Mark stable blocks; default ~5m TTL (refresh on hit); optional 1h |
| Prefix order | `tools` → `system` → `messages` |
| Context editing | `clear_tool_uses_20250919` — clear old tool results; keep last N; optional thinking clear |
| Compaction | `compact_20260112` — server summarize above trigger; client must re-send compaction block |
| Claude Code lessons (T13) | Static first; updates via **messages**; `defer_loading` stubs; compaction **fork** must reuse parent system+tools for cache hits |

## Gemini (T6)

| Mechanic | Contract |
|----------|----------|
| Implicit | Default on Gemini 2.5+ when shared content is first; **no cost-saving guarantee** |
| Explicit | Cached content objects on **generateContent** path (TTL default ~1h); Interactions API = **implicit only** |
| Min size (illustrative, official tables) | 2.5 Flash/Pro ~2048; newer 3.x preview rows list ~4096 |
| Usage | Cached token counts in response metadata (`total_cached_tokens` / related) |

*Note:* Full HTML re-fetch timed out 2026-08-02; table above from official URL snippets — re-confirm min sizes before coding Gemini-specific breakpoints.

## DeepSeek (T7) — OpenAI-compat example of automatic disk cache

| Mechanic | Contract |
|----------|----------|
| Automatic | No breakpoints required; prefix from token 0 |
| Units | 64-token storage units; shorter prefixes not cached |
| Usage | `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` |
| Best-effort | No 100% hit guarantee; unused entries expire hours–days |
| Pricing | News article USD is **historical** — use live Models & Pricing for any dollar math |

**Implication for all OpenAI-compat hosts:** Prefer stable leading `system` + `tools` JSON; treat reported cache fields as authoritative when present; when absent, log `cacheReported: false`.

## Cost visibility requirement (product)

Receipts and UI that show only **latest** step `inputTokens` understate multi-step burn by orders of magnitude. Cumulative **billed input** (sum of step inputs) is the correct cost shape for agent loops (derived from T5 economics). Mapping to VYOTIQ code/telemetry is Phase 2 — not asserted here as an audit finding.
