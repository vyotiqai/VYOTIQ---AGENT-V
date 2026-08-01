# 00 — Source inventory

**Compiled:** 2026-08-02

| ID | Source | Fetched | Confidence | Notes |
|----|--------|---------|------------|-------|
| S1 | [OpenAI Reasoning models](https://developers.openai.com/api/docs/guides/reasoning) | 2026-08-02 | Verified primary | Responses `reasoning.effort`; GPT-5.x family |
| S2 | [Anthropic Effort](https://platform.claude.com/docs/en/build-with-claude/effort) | 2026-08-02 | Verified primary | `output_config.effort`; model availability table |
| S3 | [Anthropic Thinking / steering](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost) | 2026-08-02 | Verified primary | Effort × thinking interaction; cache invalidation |
| S4 | [Anthropic Extended thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) | 2026-08-02 | Verified primary | Adaptive vs `budget_tokens`; 4.7+ rejects budget |
| S5 | [Gemini Thinking](https://ai.google.dev/gemini-api/docs/thinking) | 2026-08-02 | Verified primary | Interactions `thinking_level`; per-model level sets |
| S6 | [xAI Reasoning](https://docs.x.ai/developers/model-capabilities/text/reasoning) | 2026-08-02 | Verified primary | grok-4.5 `low|medium|high`; cannot disable |
| S7 | [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/) | 2026-08-02 | Verified primary | toggle + `reasoning_effort`; V4-pro mapping note |
| S8 | [Groq Reasoning](https://console.groq.com/docs/reasoning) | 2026-08-02 | Verified primary | GPT-OSS vs Qwen family split |
| S9 | [OpenRouter Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) | 2026-08-02 | Verified primary | Unified `reasoning` object + **catalog `reasoning` metadata** |
| S10 | OpenRouter Claude 4.6 migration (Jun 22 2026) | 2026-08-02 | Verified secondary | Maps `reasoning.effort` → Anthropic `output_config.effort` |
| S11 | VYOTIQ codebase audit (this repo) | 2026-08-02 | Verified primary (code) | See 05 / 06 |

## Conflicts

| Topic | Conflict | Resolution for Phase B |
|-------|----------|------------------------|
| Anthropic Sonnet/Opus 4.6 | Docs: adaptive + effort; older client code may still send `budget_tokens` | Prefer adaptive for 4.6+; treat budget as legacy |
| OpenRouter `reasoning_effort` flat param | Deprecated vs nested `reasoning` | Prefer nested `reasoning` (S9) |
| Gemini 2.5 budget vs 3.x level | Both accepted on some 3.x paths with surprises | Prefer `thinking_level` on Interactions |

## ID map → docs

- Contracts → `01` (S1–S9)  
- Mappings → `02`  
- Practices → `03` (esp. S3 cache + S7 tool replay)  
- Catalog APIs → `07` (S9 primary; others sparse)
