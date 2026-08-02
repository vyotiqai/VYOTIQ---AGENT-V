# Image generation — sources & bibliography

**Compiled:** 2026-08-01  
**Rule:** Prefer official docs when changing code. Secondary sources for UX patterns only.

---

## OpenAI (official)

| Source | Date / notes | Use |
|--------|--------------|-----|
| [Image generation](https://developers.openai.com/api/docs/guides/image-generation) | Fetched 2026-08-01 | Image API vs Responses; size/quality; moderation; limits |
| [Image generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation) | Fetched 2026-08-01 | Hosted tool, streaming, supported mainline models |
| [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2) | Snapshot `gpt-image-2-2026-04-21` | Model card |
| [GPT Image prompting guide](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) | **2026-04-21** | Production prompting; model matrix |
| [Images and vision](https://developers.openai.com/api/docs/guides/images-vision) | Fetched 2026-08-01 | Endpoint roles (Responses / Images / Chat) |
| [API Organization Verification](https://help.openai.com/en/articles/10910291-api-organization-verification) | Help Center | Ops prerequisite for GPT Image |

## Google (official)

| Source | Date / notes | Use |
|--------|--------------|-----|
| [Nano Banana image generation](https://ai.google.dev/gemini-api/docs/image-generation) | Fetched 2026-08-01 | Gemini image models, Interactions examples, aspect/size |
| [Imagen](https://ai.google.dev/gemini-api/docs/imagen) | Fetched 2026-08-01 | Deprecated; shutdown **2026-08-17** |
| [Gemini API changelog](https://ai.google.dev/gemini-api/docs/changelog) | Jun–Jul 2026 entries | GA releases, deprecations |
| [Migrate Imagen → Gemini Image (Firebase)](https://firebase.google.com/docs/ai-logic/imagen-models-migration) | Firebase surface | Alternate shutdown **2026-06-24**; migration shape |

## xAI (official)

| Source | Use |
|--------|-----|
| [Image generation](https://docs.x.ai/developers/model-capabilities/images/generation) | aspect_ratio, resolution, b64, batch `n` |
| [Imagine overview](https://docs.x.ai/developers/model-capabilities/imagine) | Generate + edit + video scope |
| [REST images](https://docs.x.ai/developers/rest-api-reference/inference/images) | Request/response fields |
| [Quickstart](https://docs.x.ai/developers/quickstart) | OpenAI-compat examples |

## Anthropic

| Source | Use |
|--------|-----|
| [Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision) | Image **input** only — reconfirm at implement time |
| Mid-2026 API comparisons (secondary) | Corroborate no first-party image **generation** |

## Coding-agent UX (Directional only)

| Source | Use |
|--------|-----|
| [AgentBrush — generate images in Claude/Cursor](https://agentbrush.dev/blog/generate-images-claude-cursor) | MCP → workspace file pattern; transparency two-step |
| [AgentBrush getting started](https://agentbrush.dev/getting-started) | Tool surface inspiration — not a dependency |

## Internal VYOTIQ

| Path | Use |
|------|-----|
| `src/main/agent/providers/normalize.ts` | Chat vs media filtering; text-only output modalities |
| `docs/research/03-capability-gap-analysis.md` | Gap status |
| `docs/research/04-best-practices-patterns.md` | Client tools vs hosted tools |
| `docs/research/05-prioritized-roadmap.md` | P3 placement |
| `docs/research/system-prompts/` | Harness leanness when adding tool instructions |

## Secondary (corroboration only — do not code from these alone)

| Source | Caution |
|--------|---------|
| Apiyi / blog posts on org verification errors | Useful ops tips; prefer OpenAI Help Center |
| Atlascloud xAI pricing blogs | Verify against xAI pricing page |
| Firebase Imagen shutdown blogs | Conflict with Gemini API Aug 17 date — see inventory C1 |
