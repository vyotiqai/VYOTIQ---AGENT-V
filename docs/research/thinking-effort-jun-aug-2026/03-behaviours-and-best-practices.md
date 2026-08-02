# 03 — Behaviours and best practices (Jun–Aug 2026)

## When to raise / lower effort

- **Raise** for multi-step coding, long tool loops, hard reasoning, agent orchestration.
- **Lower** for classification, short chat, latency-sensitive subagents, high-volume cheap paths.
- Prefer **routing to a smaller model** over cranking effort down on a flagship when quality collapses (**Verified secondary** industry practice; see S2 guidance for Haiku/low).

## Keep effort stable in a conversation

Anthropic (S3): changing `output_config.effort` invalidates prompt-cache breakpoints. Same pattern applies conceptually whenever effort is rendered into the prompt. Product: restore per-provider prefs, avoid mid-turn thrash.

## Tool loops and reasoning replay

- **DeepSeek (S7):** must pass `reasoning_content` back after tool calls.
- **Anthropic:** replay thinking / redacted_thinking blocks.
- **OpenAI Responses / Gemini Interactions:** use provider state IDs / thought signatures (stateful Interactions preferred).

## Cost and billing

Reasoning tokens bill as output (often 3–10× answer length). Monitor usage; `max` / `xhigh` are expensive. Effort is soft guidance, not a hard token cap (except budget APIs).

## Adaptive vs budget

2026 trend: categorical effort / thinking_level supersedes integer budgets. Keep budget only for models that still require it; never hard-code SKU matrices in UI — use catalog.

## Disable semantics

Some models **cannot** disable thinking (xAI grok-4.5; some Gemini Pro; OpenRouter `mandatory: true`). UI must hide Off when catalog says so.
