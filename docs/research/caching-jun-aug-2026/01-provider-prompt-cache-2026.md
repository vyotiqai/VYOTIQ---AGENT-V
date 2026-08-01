# Provider prompt cache (2026) vs VYOTIQ wiring

**Sources:** S1–S3 (official), S4–S6 (loop / prefix), Code in provider modules.

## Rules that matter for coding agents

1. **Exact prefix match** — static instructions and tool defs first; variable content last (S1, S2, S4).  
2. **Byte changes bust the prefix** — timestamps, reordered tools, mid-run MCP catalog changes → miss (S4).  
3. **Meter hits** — use provider usage fields; do not invent hit rates client-side.

## OpenAI (S1)

| Mechanic | Contract | VYOTIQ today |
|----------|----------|--------------|
| Implicit caching | Auto for eligible prompts (~≥1024 tokens) | Relies on provider; no extra markers required |
| `prompt_cache_key` | Routes shared prefixes; required for reliable GPT-5.6+ matching | [`loop.ts`](../../../src/main/agent/loop.ts) `promptCacheKey: runId`; nested `${runId}:${subagentId}` |
| Explicit breakpoints | `prompt_cache_breakpoint` + `prompt_cache_options.mode: explicit`, TTL `30m` | [`openai.ts`](../../../src/main/agent/providers/openai.ts), [`openaiResponses.ts`](../../../src/main/agent/providers/openaiResponses.ts) for GPT-5.6+ |
| Usage | `cached_tokens` / `prompt_cache_hit_tokens`, write tokens on 5.6+ | Parsed into `cachedInputTokens` / cache-creation fields |

## Anthropic (S2)

| Mechanic | Contract | VYOTIQ today |
|----------|----------|--------------|
| `cache_control: ephemeral` | Mark stable blocks; default ~5m TTL (refresh on hit); optional 1h | [`anthropic.ts`](../../../src/main/agent/providers/anthropic.ts) `applyCacheControl` on system + last content block |
| Prefix order | `tools` → `system` → `messages` | Provider request builder preserves order |
| Usage | `cache_read_input_tokens`, `cache_creation_input_tokens` | Mapped to stream usage |

## Gemini (S3)

| Mechanic | Contract | VYOTIQ today |
|----------|----------|--------------|
| Implicit caching | Default on 2.5+; put shared content first | No client markers; prefix stability via assemble |
| Explicit cached content | generateContent cache objects; Interactions = implicit only | Not implemented (not required for current Interactions path) |
| Usage | `cachedContentTokenCount` / `total_cached_tokens` | [`gemini.ts`](../../../src/main/agent/providers/gemini.ts), [`geminiInteractions.ts`](../../../src/main/agent/providers/geminiInteractions.ts) |

## Local prefix stability (Code)

[`assemble.ts`](../../../src/main/agent/context/assemble.ts) caches only the **stable** system prefix (harness, rules, skills metadata, …) behind a fingerprint. Session env / snapshot / memory stay in the volatile tail so they do not bust the stable cache every step (aligns with S1/S4).

MCP tool-def rebuilds are fingerprint-gated in the loop; pinning tools clears the catalog fingerprint — expected **provider** cache miss when tool JSON changes (S4), not an app bug.
