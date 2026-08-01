# 03 — Google Gemini image generation deep dive

**Compiled:** 2026-08-01  
**Primary sources:** [Nano Banana / Image generation](https://ai.google.dev/gemini-api/docs/image-generation), [Imagen (deprecated)](https://ai.google.dev/gemini-api/docs/imagen), [Changelog](https://ai.google.dev/gemini-api/docs/changelog), [Firebase Imagen migration](https://firebase.google.com/docs/ai-logic/imagen-models-migration)

---

## 1. Product naming

**Nano Banana** = Gemini’s **native** image generation/editing models (not a separate brand API).

| Public name | Model ID | Role |
|-------------|----------|------|
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | Fastest / cheapest; not optimized for multi-ref or long sequential edits |
| Nano Banana 2 | `gemini-3.1-flash-image` | **Default workhorse** — speed + quality + text + multi-ref |
| Nano Banana Pro | `gemini-3-pro-image` | Premium / complex / brand / localization |
| Nano Banana (legacy) | `gemini-2.5-flash-image` | Migrate toward 3.1 Flash Lite / Flash Image |

All generated images include a **SynthID** watermark (Verified primary).

---

## 2. API shapes

Official docs present **Interactions API** examples (`client.interactions.create`) with convenience `output_image` / `interaction.output_image.data` (base64). A **generateContent** variant of the same page exists (toggle on docs).

For VYOTIQ (already has Gemini chat + Interactions paths): prefer the shape that matches existing `geminiInteractions.ts` / generateContent clients — **do not invent a third HTTP style**. Confirm which path returns reliable image parts before locking the adapter.

### Configuration patterns (Interactions examples)

`response_format` may include:

- `type: "image"` (and optionally text+image for interleaved)
- `aspect_ratio` — e.g. `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `5:4`, …
- `image_size` — **`1K` / `2K` / `4K`** (uppercase **K** required); Flash Image also **0.5K / 512px**

Interleaved text+image stories: convenience `output_image` may miss parts — iterate steps/parts.

### Capabilities called out for Gemini 3 image models

- High-res up to **4K**
- Multi-turn create/edit
- Multiple reference images / consistency (stronger on Flash Image & Pro than Lite)
- Grounding with Google Search / Image Search on some Flash paths
- Video-to-image (Flash Image) for thumbnails/posters (May 2026)

---

## 3. Imagen deprecation (critical)

| Source | Guidance |
|--------|----------|
| Gemini API Imagen page | Imagen **deprecated**; shutdown **2026-08-17**; migrate to Nano Banana |
| Changelog 2026-06-15 | Same Aug 17 shutdown for `imagen-4.0-generate-001`, ultra, fast |
| Firebase AI Logic migration | Imagen shutdown **2026-06-24** on Firebase; use `generateContent` + Gemini Image; **mask-based Imagen capability** had a separate earlier end |

**Migration mechanics (Firebase + Imagen docs):**

- Model: e.g. `gemini-2.5-flash-image` / `gemini-3.1-flash-image` instead of `imagen-4.0-*`
- Method: `generate_content` / Interactions — **not** `generate_images`
- Response: inspect **content parts** for inline image bytes (not a dedicated ImageGenerationResponse array)
- Multi-image: Imagen `numberOfImages` — Gemini often needs **multiple calls** if you need N variants

**VYOTIQ rule:** Never add Imagen as a first-class path. If catalog still lists Imagen IDs, keep them filtered (`NON_CHAT` already matches `imagen`).

---

## 4. Safety & rights

- Uploaded references: ensure rights; do not generate infringing / deceptive / harmful content
- Subject to Google **Prohibited Use Policy**
- SynthID always present — product UX may mention watermarking for compliance honesty

---

## 5. Prompting / behavior notes (from official examples)

Google’s public examples emphasize:

- Explicit layout instructions (magazine covers, isometric cities, icons on white)
- Search-grounded accuracy when using search tools
- Brand/logo integration with provided logo images
- Clean backgrounds for iconography (“No text” when needed)

Treat these as **examples**, not a formal prompting standard like OpenAI’s cookbook — still useful for agent tool descriptions (“prefer explicit aspect ratio and subject constraints”).

---

## 6. VYOTIQ adapter implications

| Topic | Implication |
|-------|-------------|
| Auth | Existing Gemini API key |
| Model selection | Separate **image model** setting or tool arg defaulting to `gemini-3.1-flash-image` |
| Catalog | Today chat catalog filters many media models; image models must be selectable for the **tool**, not as the agent’s chat model |
| Wire path | Parse image parts robustly; save PNG/JPEG from mime; return workspace path |
| Existing Interactions | Reuse streaming/error handling patterns; image modality is new output type for the app |
