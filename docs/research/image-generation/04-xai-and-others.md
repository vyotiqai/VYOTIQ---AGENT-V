# 04 — xAI Imagine and other providers

**Compiled:** 2026-08-01  
**Primary:** [xAI image generation](https://docs.x.ai/developers/model-capabilities/images/generation), [Imagine overview](https://docs.x.ai/developers/model-capabilities/imagine), [REST images](https://docs.x.ai/developers/rest-api-reference/inference/images)

---

## 1. xAI Grok Imagine

### Endpoint

`POST https://api.x.ai/v1/images/generations`  
Auth: Bearer API key. OpenAI Python/JS SDKs work with `baseURL: https://api.x.ai/v1`.

### Models (documented)

| Model ID | Role |
|----------|------|
| `grok-imagine-image-quality` | High-fidelity / production (docs default in examples) |
| `grok-imagine-image` | Faster / cheaper iterations |

Secondary pricing blogs quote ~$0.05 / $0.02 per image — **Directional**; verify on xAI pricing page at ship time.

### Parameters (Verified primary)

| Param | Notes |
|-------|-------|
| `prompt` | Required |
| `model` | Quality or speed tier |
| `n` | Multiple variations same prompt (batch) |
| `aspect_ratio` | `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `2:1`, `1:2`, phone ratios, `auto`, … |
| `resolution` | `"1k"` \| `"2k"` |
| `response_format` | default URL · `b64_json` for agents |

### Response handling

- Default **URL is temporary** — download immediately for workspace persistence.
- Prefer **`b64_json`** in Electron main process to avoid race with URL expiry / SSRF concerns of fetching arbitrary hosts (if URL host is xAI-controlled, still prefer b64 for determinism).
- SDK exposes **`respect_moderation`** — if false, do not write the file as a successful asset.

### Editing

Natural-language edits with source image (URL or data URI); **up to 3** source images for multi-image compose/style transfer (see Imagine / multi-image-editing docs).

### Video

Imagine API also covers video generation — **out of scope** for the P3 image tool; do not conflate in v1.

---

## 2. Anthropic Claude

**Status (mid-2026):** Strong **vision** (image → text/reasoning). **No** first-party text-to-image generation API in official product comparisons and reviews corroborated for this window.

**Implication for VYOTIQ:** When the user’s chat provider is Anthropic, the image tool must still call OpenAI / Gemini / xAI (or a user-selected image provider) using the appropriate secret — **do not** claim Claude can generate.

Re-verify on [Anthropic platform docs](https://platform.claude.com/docs) immediately before implementation in case this changes.

---

## 3. Aggregators & local

| Path | Notes |
|------|-------|
| **OpenRouter** | May expose image models; verify Images vs Chat endpoint per model |
| **VYOTIQ `custom` OpenAI-compat** | Could point at a local SD / Comfy / gateway that implements `/v1/images/generations` — powerful but must feature-detect |
| **Ollama** | Primarily local chat/vision; do not assume image *generation* unless a specific model/API is documented |
| **Black Forest Labs / Flux** | Often via third-party hosts; xAI Imagine is Flux-derived on xAI’s side already |

---

## 4. Provider priority recommendation (for a multi-provider tool)

When implementing a client `generate_image` tool:

1. **Explicit tool arg** `provider` / `imageModel` if set  
2. Else **settings default image provider** (new setting — product decision)  
3. Else heuristic: if OpenAI key present → `gpt-image-2`; else Gemini key → `gemini-3.1-flash-image`; else xAI → `grok-imagine-image-quality`  
4. Else clear error: “No image-capable API key configured”

Never silently generate a 1×1 PNG placeholder.
