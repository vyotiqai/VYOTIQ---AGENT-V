# 07 — Catalog capability APIs (listModels → thinking)

**Purpose:** Phase B must populate `ModelInfo` thinking fields from live catalogs. This doc lists what each provider exposes (as of 2026-08-02).

## Target `ModelInfo` thinking shape

| Field | Meaning |
|-------|---------|
| `supportsThinking` | Model can use extended thinking / reasoning |
| `thinkingApi` | `responses` \| `interactions` \| `messages` \| `chat_completions` |
| `supportedThinkingEfforts` | Allowed product efforts (exclude Off) |
| `thinkingCanDisable` | `false` when Off / `none` rejected |
| `thinkingDefaultEffort` | Prefill when enabling |
| `thinkingSupportsTokenBudget` | May send max_tokens / budget |
| `thinkingMode` | `adaptive` \| `manual` \| `effort` \| `boolean` |

## OpenRouter — **richest** (S9) Verified primary

`GET /api/v1/models` may include:

```json
"reasoning": {
  "supported_efforts": ["high", "medium", "low", "minimal"],
  "default_effort": "medium",
  "default_enabled": true,
  "mandatory": true,
  "supports_max_tokens": true
}
```

Also: `supported_parameters` may include `reasoning` / `reasoning_effort`.

**Map:**

- presence of `reasoning` object or `reasoning` in params → `supportsThinking: true`
- `supported_efforts` → `supportedThinkingEfforts` (filter to product enum; drop `none`)
- `mandatory` → `thinkingCanDisable: false`
- `default_effort` → `thinkingDefaultEffort` (if `none`, treat as default-off)
- `supports_max_tokens` → `thinkingSupportsTokenBudget: true`
- `thinkingApi: chat_completions`, `thinkingMode: effort`

## Anthropic models list

Today used: `capabilities.vision`, `tools`, modalities — **not** thinking.

If/when `capabilities` gains thinking flags, prefer them. Until then: provider adapter may infer adaptive vs manual from **documented generation bands** in one module (fallback), not UI regex.

## OpenAI `/v1/models`

Sparse; rarely lists reasoning enums. Fallback: family heuristic for gpt-5 / o-series → Responses + known effort set including `none` for disable.

## Gemini models API

Uses `supportedGenerationMethods`, token limits. No stable public “thinking_level set” field observed in this audit — fallback: Interactions for 2.5/3.x IDs + docs tables for levels when catalog silent.

## Groq / DeepSeek / xAI / custom

OpenAI-style lists; some expose `supported_parameters`. Prefer params containing `reasoning` / `reasoning_effort` / `include_reasoning`. Else provider-family fallback.

## Ollama

Tags API often returns **names only**. Pass `providerId: 'ollama'` into `baseModelInfo`. Boolean `thinkingMode` when heuristic/catalog says think-capable.

## Priority rule

```
if catalog field present → use it
else if supported_parameters implies reasoning → supportsThinking true
else → thin ID heuristic (last resort)
```

Never maintain a growing hard-coded map of every SKU in the renderer.
