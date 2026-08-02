# 03 — HQ parameters & prompting (Jun–Aug 2026)

**Compiled:** 2026-08-01  
**Sources:** OpenAI image guide + GPT Image cookbook; Gemini image generation; xAI Imagine; OpenRouter Image API.

---

## 1. High-resolution / high-quality parameter map

| Param | OpenAI | Gemini | xAI still | OpenRouter (normalized) | VYOTIQ today |
|-------|--------|--------|-----------|-------------------------|--------------|
| Size / pixels | `size` WxH or `auto` under constraints | via `aspectRatio` + `imageSize` | `aspect_ratio` + `resolution` 1k/2k | `size` / `resolution` / `aspect_ratio` | Partial |
| Quality | `low`\|`medium`\|`high`\|`auto` | thinking_level (Flash); model tier | quality vs speed **model** | `quality` | OpenAI only |
| Format | `png`\|`jpeg`\|`webp` | mime from parts | typically png/url | `png`\|`jpeg`\|`webp`\|`svg` | Not exposed |
| Compression | 0–100 jpeg/webp | — | — | `output_compression` | Missing |
| Background | opaque/transparent/auto; **not** transparent on gpt-image-2 | — | — | `background` | Missing |
| Count `n` | supported | — | up to 10 (docs) | 1–10 | Hardcoded 1 |
| Moderation | org verification; moderation_blocked | blockReason | respect_moderation | provider-dependent | Error map only |

### OpenAI `gpt-image-2` size rules (must validate client-side)

- Max edge ≤ **3840**
- Both edges multiples of **16**
- Long/short ≤ **3:1**
- Total pixels ∈ **[655360, 8294400]**
- Popular: 1024×1024, 1536×1024, 1024×1536, 2048×2048, 2048×1152, 3840×2160, 2160×3840, `auto`
- Outputs **> 2560×1440** pixels: **experimental** — retry/fallback strategy recommended

### Gemini resolution

- Default **1K**; **2K** / **4K** for production assets; Flash Image also **0.5K**
- Always uppercase `K` (`1K` not `1k`) — VYOTIQ normalizes this

### xAI still resolution

- `1k` / `2k` only (lowercase in VYOTIQ normalizer)
- No still 4K in primary docs reviewed

---

## 2. Prompting best practices (Verified primary — OpenAI cookbook)

Applicable across strong modern image models; tune per vendor.

### Structure

1. **Background / scene → subject → details → constraints**
2. State **intended use** (UI mock, ad, sketch, icon, photoreal) to set polish mode
3. Prefer short labeled segments over one opaque paragraph for complex briefs
4. **Iterate:** base prompt → single-change edits (“warmer light,” “remove extra button”)

### Quality levers

- Drafts / volume: OpenAI `quality: "low"` (cookbook: strong for many cases)
- Final assets: `medium` / `high` or Gemini Pro / xAI quality model
- Photoreal: include “photorealistic” (or “real photograph”); avoid over-specified camera EXIF as literal physics
- Text-in-image: quote exact strings; ask for clean legible typography; high quality

### UI mockups (cookbook §4.8)

- Describe product as **already shipped** (layout, hierarchy, spacing, real controls)
- Avoid “concept art” / fantasy chrome language
- Device frame optional (“iPhone frame”) when context helps
- For **pixel-perfect interactive UI**, prefer **code-native HTML/CSS** (see [`05`](./05-code-native-visuals.md)) and use raster mocks for moodboards

### Sketches / art

- Name the medium: pencil sketch, ink wash, flat vector poster, oil painting
- Add texture cues only when needed (grain, brushstrokes)
- Style transfer: attach references via `edit_image` / `input_references`

### Edits

- Prefer “change only X; keep everything else the same”
- OpenAI Responses tool tips: prefer verbs `draw` / `edit` over vague `merge`
- Multi-ref: name Image 1…N roles in the prompt

### Localization of designs

- Preserve layout/typography; translate text verbatim; forbid unintended logo edits

---

## 3. Gemini-specific prompting / config

- Workhorse: `gemini-3.1-flash-image`; premium: `gemini-3-pro-image`
- `thinking_level`: `minimal` (default) vs `high` on Flash Image for harder briefs
- Interleaved story+illustrations: Pro Image
- Grounding (web / image search): available on newer Flash Image paths — optional; not in VYOTIQ today

---

## 4. xAI-specific

- Choose **quality** vs **speed** model rather than a quality enum
- Cap reference images at 3; no masks — use prompt locality instead
- Video prompts are a **different** tool surface (duration, camera motion language)

---

## 5. Recommended VYOTIQ tool schema additions (for later implement)

Expose (with provider ignore/validate):

- `n` (1–4 practical default max for UX)
- `output_format` / `background` / `output_compression` (OpenAI + OpenRouter)
- Presets: `preset: draft | final | ui_mock | icon` → expands to quality/size/resolution defaults
- Client-side OpenAI size validator returning actionable errors

Harness defaults:

- Drafts → low / 1K / quality model speed tier
- “high resolution” / “4K” in user text → Gemini 4K or OpenAI constrained 3840×2160 with experimental warning

---

## 6. Anti-patterns

- Retrying identical prompts after `moderation_blocked`
- Forcing `background: transparent` on `gpt-image-2`
- Passing lowercase `1k` to Gemini without normalization
- Using Imagen endpoints after 2026-08-17 shutdown
- Treating raster UI mocks as source of truth for production CSS
