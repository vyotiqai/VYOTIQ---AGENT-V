# Sources — annotated bibliography

**Compiled:** 2026-08-01  
**Package:** [`image-capability-finish`](./README.md)

---

## OpenAI

1. **Image generation guide** — https://developers.openai.com/api/docs/guides/image-generation  
   Image API vs Responses; GPT Image models; size/quality/format/compression; `n`; experimental high-res note (>2560×1440).

2. **Image generation tool (Responses)** — https://developers.openai.com/api/docs/guides/tools-image-generation  
   Hosted `type: "image_generation"`; `partial_images`; multi-turn; mainline model ≠ GPT Image model.

3. **GPT Image 2 model** — https://developers.openai.com/api/docs/models/gpt-image-2  
   Flagship still-image model ID and snapshots.

4. **GPT Image prompting cookbook** — https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide  
   Production prompting (UI mockups, ads, photoreal, localization, iterate); quality:low for drafts.

## Google

5. **Nano Banana / Gemini image generation** — https://ai.google.dev/gemini-api/docs/image-generation  
   Model family, aspect/size, 4K, thinking_level, interleaved text+image (Pro).

6. **Imagen (deprecated)** — https://ai.google.dev/gemini-api/docs/imagen  
   Shutdown 2026-08-17; migrate to Nano Banana / `generateContent`.

## xAI

7. **Imagine overview** — https://docs.x.ai/developers/model-capabilities/imagine  
   Image gen/edit (≤3 refs); video generation entry points.

8. **Video generation** — https://docs.x.ai/developers/model-capabilities/video/generation  
   Duration 1–15s; 480p/720p/1080p; modes (T2V, I2V, R2V).

9. **Videos REST** — https://docs.x.ai/developers/rest-api-reference/inference/videos  
   Async `request_id` poll lifecycle.

10. **Models / pricing** — https://docs.x.ai/developers/models  
    `grok-imagine-image`, `grok-imagine-image-quality`, `grok-imagine-video`, `grok-imagine-video-1.5`.

## OpenRouter

11. **Image Generation guide** — https://openrouter.ai/docs/guides/overview/multimodal/image-generation  
    Dedicated `/api/v1/images`, discovery, streaming, normalized params.

12. **Create images API** — https://openrouter.ai/docs/api/api-reference/images/create-images  
    OpenAPI contract.

13. **Unified Image API blog** — https://openrouter.ai/blog/announcements/image-api/  
    30+ models; capability discovery rationale.

14. **Chat Completions image path (legacy/alternate)** — https://openrouter.ai/docs/guides/overview/multimodal/image-generation.mdx  
    `modalities` on chat — see Conflict C1/C5 in [`00-source-inventory.md`](./00-source-inventory.md).

## Anthropic

15. **Vision** — https://platform.claude.com/docs/en/build-with-claude/vision  
    Image **input** only.

## Motion / web platform

16. **Using CSS animations (MDN)** — https://developer.mozilla.org/en-US/docs/Web/CSS/CSS_animations/Using_CSS_animations  
    `@keyframes`, timing, events; last modified Dec 2025.

17. **Web Animations API (MDN)** — https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API  
    Imperative animation control.

## VYOTIQ internal

18. Prior raster research — [`../image-generation/`](../image-generation/)  
19. Roadmap — [`../05-prioritized-roadmap.md`](../05-prioritized-roadmap.md)  
20. Architecture — [`../../architecture.md`](../../architecture.md)
