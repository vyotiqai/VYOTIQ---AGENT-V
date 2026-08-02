# 04 — UI and product patterns

## Control surface

Common pattern in coding agents (2026):

1. **Think toggle / cycle** on composer chrome (Off → levels).
2. Separate **Show thinking** (transcript display) from **effort** (API control).
3. **Per-provider prefs** restored when switching providers/models.
4. Lock control while a run is in progress.

## Catalog-driven UX (required)

From OpenRouter S9 (gold standard for gateways):

- Show control only if catalog indicates reasoning support.
- Filter effort chips to `supported_efforts`.
- Hide disable when `mandatory`.
- Preselect `default_effort` / respect `default_enabled`.
- If `supports_max_tokens`, optionally expose a budget control (advanced).

## Anti-patterns

- Hard-coding every Claude/GPT/Gemini SKU into the renderer.
- Always cycling the full product ladder when the model only accepts `low|high`.
- Showing Off for models that 400 on disable / `none`.
- Treating “Show thinking” as the effort control.
