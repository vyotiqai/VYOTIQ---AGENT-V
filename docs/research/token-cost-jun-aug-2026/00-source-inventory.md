# Source inventory

**Fetched / verified:** 2026-08-02 (Phase 1 refresh)  
**Snapshot notes:** [`_source-snapshot-notes-2026-08-02.txt`](./_source-snapshot-notes-2026-08-02.txt)  
**Scope:** Official cost, prompt-cache, and context-management docs for agentic coding. Code/AppData IDs reserved for Phase 2+ (not practices conclusions).

## Confidence labels

| Label | Meaning |
|-------|---------|
| **Verified primary** | Official provider / product docs fetched or cross-checked 2026-08-02 |
| **Verified secondary** | In-repo research that cites primaries; peer papers |
| **Code** | Behavior from `src/` (Phase 2) |
| **AppData evidence** | Measured from local `receipt.json` / `events.jsonl` (Phase 2–3; no secrets) |
| **Conflict** | Disagreeing claims — do not code against secondary |

## ID map

| ID | Source | Window | Confidence | Notes |
|----|--------|--------|------------|-------|
| T1 | [OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | Living; re-fetched 2026-08-02 | Verified primary | Implicit + GPT-5.6+ explicit breakpoints; `prompt_cache_key`; min ~1024; write fee 1.25× on GPT-5.6+ |
| T2 | [Anthropic Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Living; 2026-08-02 | Verified primary | `cache_control`; prefix `tools`→`system`→`messages` |
| T3 | [Anthropic Context editing](https://platform.claude.com/docs/en/build-with-claude/context-editing) | Living; 2026-08-02 | Verified primary | `clear_tool_uses_20250919`; keep last N; thinking clear strategy |
| T4 | [Anthropic cookbook: context engineering](https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools) | Living; 2026-08-02 | Verified primary | Compaction `compact_20260112`; tool clearing; memory tool |
| T5 | [Claude Code: Manage costs](https://docs.anthropic.com/en/docs/claude-code/costs) | Living; 2026-08-02 | Verified primary | `/clear`, compaction cost, MCP deferred tools, thinking cost |
| T6 | [Gemini Context caching](https://ai.google.dev/gemini-api/docs/caching) | Living; 2026-08-02 | Verified primary | Implicit on 2.5+; explicit on generateContent; Interactions = implicit only. *Full HTML timed out; contract confirmed via official page snippets.* |
| T7 | [DeepSeek Context Caching on Disk](https://api-docs.deepseek.com/news/news0802/) | Official news + API docs | Verified primary | Automatic prefix cache; hit/miss fields; 64-token units; best-effort; **USD in article is historical** |
| T8 | [OpenAI Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/) | 2026-01-23 | Verified primary | Exact prefix; static tools first. *2026-08-02 live HTML thin/timeout — retained from prior fetch + ADW S20.* |
| T9 | arXiv [Don’t Break the Cache](https://arxiv.org/abs/2601.06007) | 2026-02 preprint | Verified secondary | Strategic cache vs naive full-context; dynamic content last |
| T10 | In-repo caching pack [`../caching-jun-aug-2026/`](../caching-jun-aug-2026/) | 2026-08-02 | Verified secondary | VYOTIQ wiring map |
| T11 | Live `src/main/agent/**`, shared telemetry | Phase 2 | Code | Loop, assemble, trim, receipts |
| T12 | `%APPDATA%/vyotiq` sessions | Phase 2–3 | AppData evidence | Prefer live `80bd4074-…`; historical `1f175050-…` appendix only |
| T13 | [Anthropic: Prompt caching is everything](https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything) | 2026-04-30 | Verified primary | `defer_loading`; no mid-session tool churn; cache-safe compaction fork |

## Conflicts

| Topic | Claims | Resolution |
|-------|--------|------------|
| Cache-read discount % | Blogs vary (50–98%); DeepSeek news cites “up to 90%” | Meter provider fields only; cite **current** pricing pages for USD; do not freeze news USD |
| DeepSeek hit prices | Third-party tables disagree with older news figures | Prefer live DeepSeek Models & Pricing; news article is **mechanism**-authoritative |
| “Cache tool results” as product feature | Some blogs | **Out of scope** — do not add tool-result memoization systems |
| “60–90% cost reduction” secondary posts | Marketing / anecdote | **Do not adopt blindly** — require usage-field evidence on *this* harness |
| Hard step caps as cost control | Occasional blog advice | **Rejected** — project rule; prefer context pressure + abort + clear |

## Freeze checklist (Phase 1)

- [x] Primaries T1–T8 + T13 cited with URLs  
- [x] Snapshot notes dated 2026-08-02  
- [x] Conflicts + do-not-adopt-blindly logged  
- [x] Architecture conclusions are provider-agnostic; no AppData claims written as practices facts  
- [x] No secrets from AppData copied into this pack  
