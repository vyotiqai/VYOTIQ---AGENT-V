# 06 — Preliminary gap findings

Evidence from codebase audit 2026-08-02. Phase B implements catalog-driven fixes; this file is diagnosis only.

| ID | Gap | Evidence | Severity |
|----|-----|----------|----------|
| G1 | UI hide gate is ID-regex only | `ThinkingControls.tsx` `modelSupportsThinking(model, provider)` | P0 — control missing |
| G2 | Default ollama/qwen2.5 never shows control | Defaults + heuristic miss | P0 UX |
| G3 | Catalog never maps thinking metadata | `normalizeOpenAiStyleModels` ignores `reasoning` object / reasoning params | P0 architecture |
| G4 | Anthropic adaptive classifier stale | Misses Sonnet/Opus **4.6**; tests may still expect budget for 4.6 | P0 correctness |
| G5 | Anthropic manual ignores UI effort | Fixed `DEFAULT_MANUAL_BUDGET` 10k | P1 |
| G6 | Anthropic Off returns `{}` | Models that default-think may keep thinking | P1 |
| G7 | OpenAI Off omits `reasoning` | Should send `effort: "none"` where supported | P1 |
| G8 | Ollama effort unused; tags miss providerId | `think: true` only | P1 |
| G9 | DeepSeek/OpenRouter raw efforts | May 400 on unsupported enums | P1 |
| G10 | Groq may set exclusive fields together | `include_reasoning` + `reasoning_format` | P2 |
| G11 | Gemini generateContent path no thinking | Only Interactions configures level | P1 |
| G12 | Duplicate `ThinkingEffortSchema` | settings.ts + reasoning.ts | P2 maintainability |
| G13 | ThinkingControls has no ModelInfo prop | Cannot use catalog allowlists | P0 |
| G14 | Heuristic false negatives (o1, gemini-2.0, etc.) | Regex gaps | P1 — fixed by catalog |

## Recommended Phase B principle

**Fetch → normalize → ModelInfo → UI + wire.** Heuristics only when catalog field absent.
