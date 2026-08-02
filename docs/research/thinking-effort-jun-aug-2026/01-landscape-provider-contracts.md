# 01 — Landscape: provider contracts (Jun–Aug 2026)

Labels: **Verified primary** unless noted.

## OpenAI (Responses API) — S1

- Surface: Responses API preferred for reasoning models.
- Control: `reasoning.effort` — model-dependent set including `none`, `minimal`, `low`, `medium`, `high`, `xhigh` (and some docs mention `max` mapped toward top tier).
- Related: optional `reasoning.summary`, `reasoning.mode` (`standard`/`pro` on select SKUs), multi-turn `reasoning.context`.
- Off: send `effort: "none"` (or omit reasoning only when model is non-reasoning). Omitting on a reasoning model may leave default thinking on.
- Chat Completions still accepted but weaker for reasoning intelligence.

## Anthropic (Messages) — S2, S3, S4

- **Effort:** `output_config.effort` ∈ `low | medium | high | xhigh | max` (availability varies by model; default `high` ≡ omit).
- **Thinking modes:**
  - **Adaptive** (recommended where available): `thinking: { type: "adaptive", display? }` + effort for depth.
  - **Manual budget** (legacy): `thinking: { type: "enabled", budget_tokens }` — deprecated on 4.6; **400 on 4.7+** when budget-only path is rejected.
- Effort affects all output tokens (text, tools, thinking), not only thinking.
- Changing effort mid-conversation invalidates prompt-cache prefixes (effort is rendered into the prompt).
- Models with effort (as of fetch): Fable 5, Mythos 5, Opus 5 / 4.8 / 4.7 / 4.6, Sonnet 5 / 4.6, Opus 4.5 (effort + budget), Mythos Preview.

## Gemini (Interactions + generateContent) — S5

- **Interactions (recommended):** `generation_config.thinking_level` with **per-model** allowed sets (e.g. Pro preview: `low|high`; Flash: `minimal|low|medium|high`). Defaults differ by model.
- Thought steps + signatures required for multi-turn continuity (stateful Interactions simplifies this).
- **generateContent (2.5):** `thinkingBudget` integer (`0` off where allowed, `-1` dynamic). Mixing budget with Gemini 3 Pro can surprise — prefer level on Interactions.

## xAI — S6

- Chat: `reasoning_effort`; Responses: `reasoning.effort`.
- `grok-4.5`: `low | medium | high` (default `high`); **cannot disable**.
- Multi-agent SKUs may reuse effort to mean agent count — do not assume depth semantics.

## DeepSeek — S7

- Toggle: `thinking: { type: "enabled" | "disabled" }` (OpenAI chat via `extra_body`).
- Effort: `reasoning_effort` ∈ `low | high | max` (+ Responses maps `none` to disable). Compatibility: `xhigh` may map to `high`/`max` depending on flash vs pro (pro mapping update noted early Aug 2026).
- **Must** replay `reasoning_content` across tool-call turns or API returns 400.

## Groq — S8

- Family split:
  - GPT-OSS style: `reasoning_effort` `low|medium|high` + `include_reasoning`.
  - Qwen style: `none|default` (+ `reasoning_format`); mutually exclusive patterns with `include_reasoning` on some paths.
- Treat as provider-family adapter, not one global enum.

## OpenRouter — S9, S10

- Unified request: `reasoning: { effort?, max_tokens?, enabled?, exclude? }`.
- Flat `reasoning_effort` largely deprecated.
- **Catalog:** `GET /api/v1/models` may include per-model `reasoning` object — see `07`.
- Jun 22 2026: Claude 4.6+ maps OpenRouter `reasoning.effort` → Anthropic `output_config.effort`.

## Ollama

- Common chat field: `think: true|false` (boolean). Effort ladders are model-specific / UNVERIFIED for a universal enum — treat as boolean mode unless catalog says otherwise.

## Mistral / custom OpenAI-compat

- No universal primary for thinking effort as of this pack. Pass through only when host advertises `supported_parameters` / `reasoning` metadata.
