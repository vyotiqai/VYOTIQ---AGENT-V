# Caching research (Jun–Aug 2026) — existing VYOTIQ caches only

**Research window:** Provider prompt-cache contracts as of 2026-08-02; app-local caches = live code inventory.  
**Compiled:** 2026-08-02  
**Freeze status:** **YES — freeze-ready** (2026-08-02). Integrity notes in [`00-source-inventory.md`](./00-source-inventory.md).  
**Status:** Documentation first; later harden **existing** caches only. No new cache systems, tiers, or frameworks.

## Thesis

Keep **existing** provider prompt-cache wiring and **existing** process/disk caches correct: stable instruction prefix + volatile tail; TTL / fingerprint / generation invalidation on writes. Do not grow surface area.

## How to read

1. [`00-source-inventory.md`](./00-source-inventory.md) — primaries, confidence, conflicts  
2. [`01-provider-prompt-cache-2026.md`](./01-provider-prompt-cache-2026.md) — OpenAI / Anthropic / Gemini vs current providers  
3. [`02-existing-caches-map.md`](./02-existing-caches-map.md) — live inventory: hit / invalidate / never  
4. [`03-effects-and-do-not.md`](./03-effects-and-do-not.md) — effects when correct vs stale; do-not list  
5. [`sources.md`](./sources.md) — short bibliography  

## Integrity rules

- Prefer **official** OpenAI / Anthropic / Google docs over blogs.  
- Labels: **Verified primary** · **Verified secondary** · **Code** · **Conflict — do not code against**.  
- Code wins when research docs disagree with `src/`.  
- **Out of scope as product work:** Redis, semantic/final-answer caches, new shared cache libraries, tool-result memoization systems that do not already exist.

## Related

- Parent index: [`../README.md`](../README.md)  
- Prompt-cache patterns (root): [`../04-best-practices-patterns.md`](../04-best-practices-patterns.md) §2  
- Loop / prefix stability: [`../agentic-adw-jun-aug-2026/11-tool-use-loop-behaviours.md`](../agentic-adw-jun-aug-2026/11-tool-use-loop-behaviours.md)  

## Verification (2026-08-02)

- C1 gitignore invalidation fixed in `tools/gitignore.ts` + `tools/index.ts`  
- `pnpm exec vitest run tests/main/e2e/workspaceCacheInvalidation.test.ts tests/main/unit/gitignoreSearch.test.ts` (+ related `*Cache*` units) — **pass**  
