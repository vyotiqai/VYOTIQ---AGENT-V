# 00 — Source inventory & confidence

**Compiled:** 2026-08-01  
**Window:** Jun–Aug 2026 (research day is early August; August primary sources are thinner than June–July)

## Confidence labels

| Label | Meaning |
|-------|---------|
| **Verified primary** | Directly from official docs / changelog / help center fetched or searched on 2026-08-01 |
| **Verified secondary** | Corroborating industry write-up; not used alone for API shapes |
| **Directional** | Sensible pattern for coding agents; must be validated in VYOTIQ before shipping |
| **Conflict** | Two primary (or primary vs Firebase) sources disagree — resolve before coding |

---

## Fetched / consulted primary sources (2026-08-01)

### OpenAI

| URL | Topic | Confidence |
|-----|-------|------------|
| https://developers.openai.com/api/docs/guides/image-generation | Image API + Responses overview, customize output, moderation, limits | Verified primary |
| https://developers.openai.com/api/docs/guides/tools-image-generation | Hosted `image_generation` tool, streaming partials, supported mainline models | Verified primary |
| https://developers.openai.com/api/docs/models/gpt-image-2 | Model card; snapshot `gpt-image-2-2026-04-21` | Verified primary |
| https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide | Prompting guide dated **2026-04-21**; model matrix + size constraints | Verified primary |
| https://developers.openai.com/api/docs/guides/images-vision | Vision vs generation endpoints matrix | Verified primary |
| https://help.openai.com/en/articles/10910291-api-organization-verification | Org verification requirements (search synthesis; page fetch timed out) | Verified primary (via search snippet) |

### Google

| URL | Topic | Confidence |
|-----|-------|------------|
| https://ai.google.dev/gemini-api/docs/image-generation | Nano Banana / Gemini image Models; Interactions API examples | Verified primary |
| https://ai.google.dev/gemini-api/docs/imagen | Imagen deprecated; migrate to Nano Banana; shutdown **2026-08-17** | Verified primary |
| https://ai.google.dev/gemini-api/docs/changelog | Jun–Jul 2026 releases/deprecations | Verified primary |
| https://firebase.google.com/docs/ai-logic/imagen-models-migration | Firebase AI Logic Imagen shutdown **2026-06-24** | Verified primary (Firebase surface) |

### xAI

| URL | Topic | Confidence |
|-----|-------|------------|
| https://docs.x.ai/developers/model-capabilities/images/generation | Imagine generation, aspect ratio, 1k/2k, b64, moderation flag | Verified primary |
| https://docs.x.ai/developers/model-capabilities/imagine | Imagine API overview (image + video) | Verified primary |
| https://docs.x.ai/developers/rest-api-reference/inference/images | `POST /v1/images/generations` | Verified primary |
| https://docs.x.ai/developers/quickstart | OpenAI-compat SDK examples | Verified primary |

### Anthropic

| URL | Topic | Confidence |
|-----|-------|------------|
| Platform / product comparisons + Anthropic vision docs | Claude: image **input** (vision), **no** first-party image **generation** API as of mid-2026 | Verified secondary + directional; reconfirm on Anthropic docs at implement time |

### Coding-agent ecosystem (patterns only)

| URL | Topic | Confidence |
|-----|-------|------------|
| https://agentbrush.dev/blog/generate-images-claude-cursor | MCP image server → file in workspace | Directional (vendor blog) |
| https://agentbrush.dev/getting-started | Tool surface: generate, bg remove, references | Directional |

### VYOTIQ codebase (local evidence)

| Path | Finding |
|------|---------|
| `src/main/agent/providers/normalize.ts` | `NON_CHAT` filters `dall-e`, `imagen`, `imagine`, `veo`, …; **`wireSupportedOutputModalities` forces text-only** (“no image generation path”) |
| `docs/research/03-capability-gap-analysis.md` | Image generation = Missing |
| `docs/research/05-prioritized-roadmap.md` | P3 Image generation tool |

---

## Explicit conflicts (do not code against until resolved)

### C1 — Imagen shutdown date

| Surface | Stated shutdown |
|---------|-----------------|
| Gemini API Imagen docs + changelog (2026-06-15) | **2026-08-17** for Imagen 4 model IDs |
| Firebase AI Logic migration guide / secondary blogs | **2026-06-24** for Imagen on Firebase |

**Resolution for VYOTIQ:** Prefer **Gemini native image models** (`gemini-*-image*`) — never new Imagen integrations. Treat both dates as “Imagen is exiting; do not build on it.”

### C2 — OpenAI `gpt-image-2` max edge

| Source | Constraint |
|--------|------------|
| Official Image generation guide (2026-08-01 fetch) | Max edge **≤ 3840px** |
| Cookbook prompting guide (2026-04-21) | Max edge **&lt; 3840px**; suggests rounding 4K down |

**Resolution:** Prefer the **Image generation guide** at implement time; add a unit test that validates sizes against the live docs quote in a comment.

### C3 — Responses tool “supported models” vs examples

| Source | Models |
|--------|--------|
| `tools-image-generation` supported list | Lists `gpt-5.5`, `gpt-5.4-*`, `gpt-5`, `gpt-5.2`, `o3`, `gpt-4.1*`, `gpt-4o*` — **did not list `gpt-5.6` in the fetched page** |
| Same guide’s code samples | Use `model: "gpt-5.6"` |

**Resolution:** At implement time, confirm each seed chat model’s model-card “supports image generation tool” flag; do not assume every GPT-5.x mainline model hosts the tool.

---

## What this package does **not** claim

- Exact live pricing (token tables change; use OpenAI/xAI/Google calculators at ship time).
- That DALL·E 3 remains the recommended OpenAI path (current official guidance is **GPT Image**, esp. `gpt-image-2`).
- That Anthropic will never ship image gen (only that it is **not** available as of this research).
- Implementation completeness — this is research only.
