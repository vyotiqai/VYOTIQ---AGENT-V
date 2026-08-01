# 02 — Effort levels and mappings

## Unified product ladder (VYOTIQ)

`Off` · `minimal` · `low` · `medium` · `high` · `xhigh` · `max`

Wire-time coercion must clamp to **catalog `supportedThinkingEfforts`** when present; otherwise use provider normalizers below.

## Mapping table

| Product | OpenAI Responses | Anthropic effort | Gemini Interactions | xAI grok-4.5 | DeepSeek | Groq (GPT-OSS) | OpenRouter |
|---------|------------------|------------------|---------------------|--------------|----------|----------------|------------|
| Off | `none` | disable thinking / omit | omit or lowest where required | **N/A (cannot)** | `thinking.disabled` / effort `none` | omit / `none` | `effort: none` or disable |
| minimal | `minimal` | → `low` | `minimal` (if allowed) | → `low` | → `low` | → `none` or `low` | `minimal` |
| low | `low` | `low` | `low` | `low` | `low` | `low` | `low` |
| medium | `medium` | `medium` | `medium` (if allowed; else nearest) | `medium` | → `high` on some SKUs | `medium` | `medium` |
| high | `high` | `high` | `high` | `high` | `high` | `high` | `high` |
| xhigh | `xhigh` | `xhigh` (if model supports) | → `high` | → `high` | → `high`/`max` | → `high` | `xhigh` |
| max | → `xhigh` | `max` (if supported) | → `high` | → `high` | `max` | → `high` | `max` |

## Defaults (practice)

| Provider | Sensible product default |
|----------|--------------------------|
| OpenAI GPT-5.x | `medium` |
| Anthropic Sonnet 4.6 / Opus coding | `medium`–`high`; Opus 4.7+ coding often start `xhigh` then measure |
| Gemini Flash | model default (often `medium`) |
| xAI grok-4.5 | `high` (API default); hide Off |
| DeepSeek | `high` (API default when thinking on) |
| OpenRouter | catalog `default_effort` / `default_enabled` |

## Manual Anthropic budget (legacy only)

When catalog/mode = manual: map effort → rough `budget_tokens` bands (illustrative; prefer adaptive):

| Effort | Suggested budget_tokens |
|--------|-------------------------|
| low | 2_048 |
| medium | 8_192 |
| high | 16_384 |
| xhigh / max | 32_768 |

**Conflict:** Do not send `budget_tokens` on models that reject it (4.7+).
