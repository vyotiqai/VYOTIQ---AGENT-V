# Source inventory

**Fetched / verified:** 2026-08-02  
**Scope:** Official prompt/context caching docs + live VYOTIQ code paths. Secondary blogs omitted unless they conflict with primaries (logged below).

## Confidence labels

| Label | Meaning |
|-------|---------|
| **Verified primary** | Official provider docs fetched or cross-checked 2026-08-02 |
| **Verified secondary** | In-repo research that cites primaries |
| **Code** | Behavior taken from `src/` |
| **Conflict** | Disagreeing claims — do not implement against secondary |

## ID map

| ID | Source | Date / window | Confidence | Notes |
|----|--------|---------------|------------|-------|
| S1 | [OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | Living docs; GPT-5.6+ rules current as of fetch 2026-08-02 | Verified primary | Implicit + explicit breakpoints; `prompt_cache_key`; TTL `30m`; min ~1024 tokens; write 1.25× on GPT-5.6+ |
| S2 | [Anthropic Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Living docs 2026-08-02 | Verified primary | Automatic top-level `cache_control` or per-block; prefix `tools`→`system`→`messages`; default 5m TTL; optional 1h; ≤4 breakpoints |
| S3 | [Gemini Context caching](https://ai.google.dev/gemini-api/docs/caching) | Living docs 2026-08-02 | Verified primary | Implicit on 2.5+; Interactions API = implicit only; explicit via generateContent cache objects |
| S4 | [OpenAI Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) | 2026-01-23 | Verified primary (still governing) | Exact prefix; static tools first; MCP list change → miss |
| S5 | Root [`04-best-practices-patterns.md`](../04-best-practices-patterns.md) §2 | 2026-08-01 | Verified secondary | Stable prefix; Anthropic/OpenAI markers; meter cache |
| S6 | ADW [`11-tool-use-loop-behaviours.md`](../agentic-adw-jun-aug-2026/11-tool-use-loop-behaviours.md) | 2026-08-02 | Verified secondary | Cites S4 caching rules |
| S7 | Live `src/main/agent/**`, `src/main/git/**`, renderer caches | 2026-08-02 | Code | Inventory in `02` |

## Conflicts

| Topic | Claims | Resolution |
|-------|--------|------------|
| OpenAI cached-read discount | Some SEO posts say 50% forever; others 90% for GPT-5.x | **Use S1 pricing pages / model pricing**, not blogs. VYOTIQ only meters provider-reported cached tokens. |
| “Never cache tool results” vs “cache tool results with TTL” | Agentic blog disagreement | **For this product:** do not add tool-result memoization. Existing short TTL caches (git status, snapshots) with write invalidation are already correct. |
| Gemini discount % | Blog variance (25% / 75% / 90%) | **Use S3**; VYOTIQ only surfaces `cachedInputTokens` from usage metadata. |

## Freeze checklist

- [x] Primaries S1–S3 cited with URLs  
- [x] Conflicts logged; no blog-driven product requirements  
- [x] Pack limited to existing caches (no new tiers recommended)  
- [x] Code inventory in `02` tied to file paths  
