# 06 — Routing & capability detection

**Compiled:** 2026-08-01  
**Tied to:** [`01-current-vyotiq-audit.md`](./01-current-vyotiq-audit.md), [`02-provider-model-matrix-2026.md`](./02-provider-model-matrix-2026.md)

---

## 1. Product requirement

Image tools must **automatically work** when:

- The **chat** provider/model cannot generate images (Anthropic, Ollama, text-only OpenRouter chat models, etc.), **and**
- At least one **image-capable** API key (or OpenRouter/custom image host, once wired) is configured.

This is already the architectural spine — finish work must not regress it.

---

## 2. Current resolution algorithm

From `resolveImageGenProvider` in `src/main/agent/providers/imageGen/index.ts`:

1. Tool arg `provider` if valid image id and key exists  
2. Else Settings `imageProvider` if not `auto` and key exists  
3. Else chat `settings.provider` if it is `openai`|`gemini`|`xai` and key exists  
4. Else first of `openai` → `gemini` → `xai` with a key  
5. Else error listing those three

**Model:** tool `model` → Settings `imageModel` → `DEFAULT_IMAGE_MODELS[provider]`.

---

## 3. Gaps in “automatic”

| Gap | Effect | Finish recommendation |
|-----|--------|------------------------|
| OpenRouter key ignored | User with only OpenRouter cannot generate | Extend `ImageGenProviderId` + AUTO_PRIORITY / settings |
| Custom host ignored | Same | Settings gate + probe |
| Chat OpenRouter with image modalities | Not used | Prefer dedicated Image API; don’t hijack chat stream |
| Catalog filter strips image models from chat | Correct for chat | Keep; image models live in image settings / tool args |
| No capability badge in composer | User unsure if image will work | Directional UX: show “Image: OpenAI ready” from key presence |
| Wrong params for chosen provider | Silent ignore (`size` on Gemini) | Normalize or warn in tool result |

---

## 4. Target capability matrix (conceptual)

| Chat provider | Image key available | Expected behavior |
|---------------|---------------------|-------------------|
| anthropic | openai | Use OpenAI images |
| ollama | gemini | Use Gemini images |
| openai | openai | Prefer OpenAI (chat match) |
| openrouter | openrouter only | Use OpenRouter Image API (once wired) |
| any | none | Clear error: configure image-capable provider |
| any | multiple | Honor settings / explicit / AUTO_PRIORITY |

---

## 5. Detection layers (future)

```
Layer A — Key presence (shipped)
Layer B — Provider feature flags (OpenRouter discovery cache; custom probe)
Layer C — Per-model supported_parameters (OpenRouter endpoints API; OpenAI size validator)
Layer D — Task type routing (raster vs code-native vs video) — harness + optional tools
```

**Task type (Directional):**

| User intent | Path |
|-------------|------|
| Photoreal / illustration / paint | `generate_image` / `edit_image` |
| Pixel-perfect UI / icon / diagram as code | Write `.svg` / `.html` (see [`05-code-native-visuals.md`](./05-code-native-visuals.md)) |
| Motion micro-interaction | CSS/SVG animation in HTML (see [`08-motion-animations.md`](./08-motion-animations.md)) |
| Short generative video | Future `generate_video` (xAI) — Settings gated |

---

## 6. Settings surface (finish)

Keep:

- `imageProvider`: `auto` | first-party | (+ `openrouter` | `custom` when ready)
- `imageModel`: free string override

Add (recommended):

- `imageQualityDefault` / prefer `quality: low` for drafts in harness
- OpenRouter: optional default image model slug
- Custom: `customImageEnabled` boolean
- Video: separate enable flag (do not mix with still)

---

## 7. Acceptance checks

- [ ] Anthropic chat + only Gemini key → `generate_image` succeeds
- [ ] Explicit `provider: xai` with missing key → actionable error
- [ ] `imageProvider: auto` with OpenAI+Gemini keys → OpenAI chosen (document if changed)
- [ ] After OpenRouter: only OpenRouter key → generation works without first-party keys
- [ ] Harness text states chat≠image provider clearly
