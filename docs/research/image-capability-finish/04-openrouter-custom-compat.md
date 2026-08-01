# 04 — OpenRouter & custom OpenAI-compatible hosts

**Compiled:** 2026-08-01  
**Confidence:** OpenRouter = Verified primary. Custom hosts = Directional (feature-detect).

---

## 1. OpenRouter — recommended integration shape

### Why it matters for “all providers that support image gen”

OpenRouter’s dedicated Image API aggregates **30+** image models (OpenAI, Google, Black Forest Labs, Recraft, ByteDance, xAI, etc.) behind one key and one request shape — the practical way for VYOTIQ to reach models beyond the three first-party adapters without N vendor SDKs.

### Endpoints (preferred)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/v1/images/models` | List models + capability union |
| GET | `/api/v1/images/models/{id}/endpoints` | Per-provider truth (params, pricing, streaming, passthrough) |
| POST | `/api/v1/images` | Generate (base64 in `data[].b64_json`) |

Auth: `Authorization: Bearer $OPENROUTER_API_KEY` (reuse existing OpenRouter secret).

### Normalized request fields to map from VYOTIQ tools

`model`, `prompt`, `n`, `resolution`, `aspect_ratio`, `size`, `quality`, `output_format`, `background`, `output_compression`, `seed`, `stream`, `input_references`, `provider` routing object.

### Response handling

- Decode `b64_json`; honor `media_type` (`image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`).
- Persist with correct extension from mime (SVG is a **code-native adjacent** win via Recraft vector models).
- Surface `usage.cost` when present for metering (Directional for composer UX).

### Conflict: chat Completions modalities path

Older/alternate docs still describe `POST /api/v1/chat/completions` with `modalities: ["image"]` or `["image","text"]`.

**Recommendation for VYOTIQ:** Implement **dedicated Image API only** in v1 of an OpenRouter image adapter. Keep chat-modalities as a fallback only if discovery shows a model unavailable on `/images` (unlikely for new greenfield).

### Streaming

If `supports_streaming`, SSE events:

- `image_generation.partial_image` → optional preview (product choice; prior polish chose status-only for first-party).
- `image_generation.completed` → final bytes.
- Early disconnect = not billed (OpenRouter policy).

### Failure modes

| Failure | Handling |
|---------|----------|
| 402 insufficient credits | Clear Settings / billing message |
| Unsupported param for endpoint | Pre-check via `supported_parameters`; strip or error before call |
| Provider outage | Honor `provider.allow_fallbacks` / `order` |
| SVG / non-PNG mime | Do not force `.png` path |

---

## 2. Custom OpenAI-compatible (`custom` provider)

### Reality

Many local/proxy hosts implement Chat Completions only. Image support is **not** implied by “OpenAI-compatible.”

### Feature detection (Directional → required before enabling in UI)

1. Probe `GET {base}/images/models` **or** `GET {base}/models` and look for image-capable IDs (fragile).
2. Safer: Settings toggle **“Enable image generation on custom host”** + optional model ID; on first use try `POST {base}/images/generations` with tiny prompt and treat 404/501 as “host does not support images.”
3. Cache capability per `customOpenAiBaseUrl` in app state.

### Mapping

If host speaks OpenAI Images:

- Reuse `openaiImageAdapter` with injectable `baseUrl` (today hardcoded `https://api.openai.com`).
- Edits: multipart `/images/edits` may be incomplete on clones — probe separately.

### Do not

- Silently route `generate_image` to custom chat base without a successful capability check.
- Assume DALL·E-only hosts accept `gpt-image-2` parameters.

---

## 3. Acceptance criteria (future implement plan)

- [x] OpenRouter adapter: discovery + generate + write workspace file
- [x] `provider: 'openrouter'` in tool schema / settings `imageProvider`
- [x] Model list UI or free-text model slug with validation against discovery cache
- [x] Custom host: explicit enable + probe; reuse OpenAI adapter with base URL
- [x] Tests: mock `/api/v1/images` success, 402, unsupported param, svg mime
- [x] Docs: never claim “all OpenRouter models” without discovery

---

## 4. Priority vs first-party finish

Order recommended in [`07-vyotiq-finish-mapping.md`](./07-vyotiq-finish-mapping.md):

1. Finish OpenAI/Gemini/xAI HQ params + validation (users already have keys).
2. OpenRouter Image API adapter (largest reach expansion).
3. Custom host feature-detect (power users).
