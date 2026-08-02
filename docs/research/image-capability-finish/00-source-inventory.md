# 00 — Source inventory & confidence

**Compiled:** 2026-08-01  
**Window:** June 2026 · July 2026 · August 2026 (research day early August; August primary pages still govern live APIs)  
**Package status:** Documentation only — no product code changes in this pass

## Confidence labels

| Label | Meaning |
|-------|---------|
| **Verified primary** | Official docs / API reference / cookbook fetched or searched on 2026-08-01 |
| **Verified secondary** | Corroborating industry write-up; not used alone for API shapes |
| **Directional** | Sensible coding-agent pattern; must be validated in VYOTIQ before shipping |
| **Conflict** | Two sources disagree, or prior research vs live docs — resolve before coding |

---

## Fetched / consulted primary sources (2026-08-01)

### OpenAI

| URL | Topic | Confidence |
|-----|-------|------------|
| https://developers.openai.com/api/docs/guides/image-generation | Image API + Responses overview; customize size/quality/format; GPT Image 2 constraints | Verified primary |
| https://developers.openai.com/api/docs/guides/tools-image-generation | Responses hosted `image_generation` tool; partial_images; multi-turn | Verified primary |
| https://developers.openai.com/api/docs/models/gpt-image-2 | Model card `gpt-image-2` / snapshot | Verified primary |
| https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide | Prompting patterns (UI, ads, photoreal, iterate); dated 2026-04-21, still governing | Verified primary |

### Google Gemini

| URL | Topic | Confidence |
|-----|-------|------------|
| https://ai.google.dev/gemini-api/docs/image-generation | Nano Banana models; Interactions + generateContent; 0.5K–4K; grounding notes | Verified primary |
| https://ai.google.dev/gemini-api/docs/imagen | Imagen deprecated; shutdown 2026-08-17; migrate to Nano Banana | Verified primary |

### xAI

| URL | Topic | Confidence |
|-----|-------|------------|
| https://docs.x.ai/developers/model-capabilities/imagine | Imagine overview: image gen/edit + video | Verified primary |
| https://docs.x.ai/developers/model-capabilities/video/generation | Text/image/reference-to-video; duration; resolution | Verified primary |
| https://docs.x.ai/developers/rest-api-reference/inference/videos | `POST /v1/videos/generations` async poll | Verified primary |
| https://docs.x.ai/developers/models | Imagine pricing table (image + video models) | Verified primary |

### OpenRouter

| URL | Topic | Confidence |
|-----|-------|------------|
| https://openrouter.ai/docs/guides/overview/multimodal/image-generation | Dedicated Image API `/api/v1/images`; discovery; streaming | Verified primary |
| https://openrouter.ai/docs/api/api-reference/images/create-images | OpenAPI for create images | Verified primary |
| https://openrouter.ai/blog/announcements/image-api/ | Unified Image API announcement (30+ models) | Verified primary |
| https://openrouter.ai/docs/guides/overview/multimodal/image-generation.mdx | **Also** documents Chat Completions/Responses `modalities` path | **Conflict** with dedicated `/images` guide — both exist; see § Conflicts |

### Anthropic

| URL | Topic | Confidence |
|-----|-------|------------|
| https://platform.claude.com/docs/en/build-with-claude/vision | Vision **input** only (JPEG/PNG/GIF/WebP); no generation endpoint | Verified primary |
| https://platform.claude.com/docs/en/claude_api_primer | Messages multimodal = analyze images, not create | Verified primary |

### Motion / code-native (web platform)

| URL | Topic | Confidence |
|-----|-------|------------|
| https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations | CSS `@keyframes` / animation properties (MDN updated Dec 2025; still current Aug 2026) | Verified primary |
| https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API | WAAPI (linked from MDN animations) | Verified primary |

### Prior VYOTIQ research (reuse, not re-author)

| Path | Use |
|------|-----|
| [`../image-generation/`](../image-generation/) | Slice A–C raster research; now partly superseded by shipped code + this package |
| [`../05-prioritized-roadmap.md`](../05-prioritized-roadmap.md) | P3 placement |

### Codebase audit (this package)

| Area | Paths |
|------|-------|
| Adapters | `src/main/agent/providers/imageGen/` |
| Tools | `generateImage.ts`, `editImage.ts`, `schemas/tools.ts` |
| Settings / UI | `settings.ts`, `AgentSection.tsx`, `GenerateImageBody.tsx` |

---

## Conflicts to resolve before coding

| ID | Conflict | Resolution guidance |
|----|----------|---------------------|
| **C1** | OpenRouter: dedicated `POST /api/v1/images` vs Chat Completions `modalities: ["image"]` | Prefer dedicated Image API for new VYOTIQ adapter (typed discovery + normalized params). Treat chat-modalities path as legacy/alternate; feature-detect via `/api/v1/images/models`. |
| **C2** | Prior package said xAI video “out of scope”; official Imagine docs now fully document video | Video is **real** (Verified primary). Keep as **separate tool/phase**, not silently folded into `generate_image`. |
| **C3** | Gemini Interactions API docs vs VYOTIQ `generateContent` adapter | Both valid per Google. Current code uses `generateContent` + `responseModalities: ["TEXT","IMAGE"]` — keep unless Interactions is required for grounding. |
| **C4** | OpenAI `gpt-image-2` transparent background: guide says not supported | Do not expose `background: transparent` for `gpt-image-2` without model gate. |
| **C5** | Older OpenRouter mdx still emphasizes chat completions for images | Superseded for greenfield by dedicated Image API announcement + guide; cite both in inventory. |

---

## Explicitly not claimed

- Live smoke tests with production API keys (manual acceptance still open).
- Exact OpenRouter model catalog IDs beyond examples (catalog churns; use discovery API).
- Ollama / DeepSeek / Groq / Mistral first-party image generation (no Verified primary for gen APIs found in this pass).
- That Anthropic will ship image gen (vision-only confirmed).
- That custom OpenAI-compat hosts implement `/v1/images/*` (must feature-detect).
- Chat tool-card entrance animations as a product capability.
