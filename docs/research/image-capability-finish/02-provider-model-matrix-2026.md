# 02 — Provider & model matrix (Jun–Aug 2026)

**Compiled:** 2026-08-01  
**Authority:** Official docs fetched this day. Model IDs churn — prefer live catalogs at runtime.

---

## 1. Who can generate images?

| Vendor / VYOTIQ chat ID | Image generation? | How | VYOTIQ today | Auto-route rule |
|-------------------------|-------------------|-----|--------------|-----------------|
| **OpenAI** (`openai`) | Yes | Image API + Responses tool | Wired | Prefer when key present (AUTO_PRIORITY #1) |
| **Gemini** (`gemini`) | Yes | Nano Banana via `generateContent` / Interactions | Wired | AUTO_PRIORITY #2 |
| **xAI** (`xai`) | Yes (still + **video**) | Imagine `/v1/images/*`, `/v1/videos/*` | Still wired; video not | AUTO_PRIORITY #3 |
| **OpenRouter** (`openrouter`) | Yes | Dedicated `/api/v1/images` (+ alternate chat modalities) | **Wired** | Discovery + generate/edit via `openrouterImageAdapter` |
| **Custom** (`custom`) | Maybe | Only if host implements OpenAI-style images | **Not wired** | Feature-detect `/v1/images/generations` |
| **Anthropic** (`anthropic`) | **No** | Vision input only | N/A | Never claim; fall through to image keys |
| **Ollama** (`ollama`) | Not verified | No Verified primary gen API in this pass | N/A | Do not claim |
| **DeepSeek / Groq / Mistral** | Not verified | No first-party gen found | N/A | Do not claim |

---

## 2. OpenAI — still images

| Model | Role | Notes |
|-------|------|-------|
| `gpt-image-2` | Flagship (default in VYOTIQ) | Flexible size under constraints; strong text/UI; no transparent bg |
| `gpt-image-1.5` / `gpt-image-1` | Legacy | Keep for migration only |
| `gpt-image-1-mini` | Cheap/fast | Cookbook: often similar to quality:low on gpt-image-2 for drafts |

**Endpoints:** `POST /v1/images/generations`, `POST /v1/images/edits`  
**Alt spine:** Responses `tools: [{ type: "image_generation" }]` with mainline model (`gpt-5.x`, etc.) — tool picks GPT Image model.

**HQ surface:** `size`, `quality` (low|medium|high|auto), `output_format`, `output_compression`, `background`, `n`, moderation behavior.

**Size constraints (`gpt-image-2`):** max edge ≤ 3840; edges ×16; long/short ≤ 3:1; pixels ∈ [655360, 8294400]; >2560×1440 experimental.

---

## 3. Google Gemini — Nano Banana

| Product name | Model ID | Role |
|--------------|----------|------|
| Nano Banana 2 Lite | `gemini-3.1-flash-lite-image` | Fastest/cheapest; weak multi-ref / multi-turn |
| Nano Banana 2 | `gemini-3.1-flash-image` | Default workhorse; 4K; multi-ref; VYOTIQ default |
| Nano Banana Pro | `gemini-3-pro-image` | Premium; interleaved text+image; brand/precision |
| Nano Banana (legacy) | `gemini-2.5-flash-image` | Migrate away |

**Resolutions:** `1K` (default), `2K`, `4K`; Flash Image also `0.5K` / 512px. **Uppercase `K` required.**

**Imagen:** Deprecated; shutdown **2026-08-17** — do not build new Imagen clients.

**Silent failure pattern:** `responseModalities` must include both `TEXT` and `IMAGE` (VYOTIQ already does).

---

## 4. xAI Imagine

### Still

| Model | Role | Pricing (docs table) |
|-------|------|----------------------|
| `grok-imagine-image-quality` | Quality default (VYOTIQ) | ~$0.05 / image |
| `grok-imagine-image` | Speed/cheap | ~$0.02 / image |

**Params:** `n` up to 10 (docs overview); `aspect_ratio`; `resolution` `1k`|`2k` (VYOTIQ normalizes; no 4K still). Edit ≤ **3** reference images. No mask API.

### Video (Verified primary — separate capability)

| Model | Role |
|-------|------|
| `grok-imagine-video-1.5` | Current video (up to 1080p T2V/I2V) |
| `grok-imagine-video` | Prior / cheaper per-sec |

**API:** Async `POST /v1/videos/generations` → poll `GET /v1/videos/{request_id}`. Duration 1–15s. Modes: text-to-video, image-to-video, reference-to-video, edit, extend.

**Do not** fold into `generate_image` without a dedicated tool and Settings gate.

---

## 5. OpenRouter (aggregator)

- **Discovery:** `GET /api/v1/images/models` (+ per-model `/endpoints`).
- **Generate:** `POST /api/v1/images` with `model` slug (e.g. `openai/gpt-image-2`, `bytedance-seed/seedream-4.5`).
- **Normalized params:** `resolution`, `aspect_ratio`, `size`, `quality`, `output_format` (incl. **svg** for vector models), `background`, `n` (1–10), `stream`, `input_references`.
- **Streaming:** When `supports_streaming: true` — SSE partial + completed events.
- **Billing:** All-or-nothing (failed/cancelled not billed for image output).

See [`04-openrouter-custom-compat.md`](./04-openrouter-custom-compat.md).

---

## 6. What VYOTIQ should claim in product copy

**Must:** “Works with OpenAI, Gemini, and xAI image APIs; auto-selects from configured keys; works even when the chat model cannot generate images.”

**May (after finish plan):** “Optional OpenRouter Image API”; “Optional custom OpenAI-compatible image host”; “Code-native SVG/HTML visuals”; “xAI video (separate tool).”

**Must not:** Claim Anthropic/Ollama/etc. generate images.
