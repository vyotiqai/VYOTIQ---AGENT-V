# 01 — Image generation landscape (Jun–Aug 2026)

**Compiled:** 2026-08-01  
**Scope:** Provider capabilities relevant to a coding-agent **image generation tool**.

---

## 1. Mid-2026 snapshot

| Provider | Generate? | Edit / reference? | Primary API shape | Default model IDs (as of research) | Notes |
|----------|-----------|-------------------|-------------------|------------------------------------|-------|
| **OpenAI** | Yes | Yes (edits endpoint + Responses multi-turn) | (A) `POST /v1/images/generations` & edits · (B) Responses built-in `image_generation` tool | `gpt-image-2` (+ `gpt-image-1.5`, `1`, `1-mini`) | Org verification may be required. Default for new builds: `gpt-image-2`. |
| **Google Gemini** | Yes | Yes (multi-image, conversational) | Interactions API and/or `generateContent` with image response modality | `gemini-3.1-flash-image` (workhorse), `gemini-3-pro-image` (premium), `gemini-3.1-flash-lite-image` (cheap/fast), legacy `gemini-2.5-flash-image` | Brand: **Nano Banana**. SynthID on outputs. Prefer over Imagen. |
| **Google Imagen** | Deprecated | Mask/capability models exiting | Legacy `generate_images` / predict | `imagen-4.0-*` | Gemini API: shutdown **2026-08-17**. Firebase surface: earlier **2026-06-24**. **Do not build new Imagen paths.** |
| **xAI** | Yes | Yes (up to 3 reference images) | `POST https://api.x.ai/v1/images/generations` (OpenAI-compat) | `grok-imagine-image-quality`, `grok-imagine-image` | Default response = temporary **URL**; prefer `b64_json` for agent file writes. |
| **Anthropic Claude** | **No** | N/A (vision input only) | Messages API image blocks as **input** | — | Pair Claude agents with OpenAI/Gemini/xAI (or MCP) for generation. |
| **OpenRouter / custom `/v1`** | Varies | Varies | Often OpenAI Images-compatible | Upstream-dependent | Useful via VYOTIQ `custom` / OpenRouter only if endpoint parity is verified. |

---

## 2. June–August 2026 chronology (Google-heavy)

From [Gemini API changelog](https://ai.google.dev/gemini-api/docs/changelog) (Verified primary):

| Date | Event |
|------|-------|
| **2026-05-28** | GA: `gemini-3.1-flash-image` (Nano Banana 2), `gemini-3-pro-image` (Nano Banana Pro); video-to-image on Flash Image; preview image IDs shut down **2026-06-25** |
| **2026-06-15** | Deprecation: Imagen 4 IDs → shutdown **2026-08-17**; Veo older IDs → **2026-06-30** |
| **2026-06-30** | `gemini-3.1-flash-lite-image` (Nano Banana 2 Lite) released GA |
| **2026-07-xx** | Continued Gemini API notes (see changelog); image stack remains Nano Banana–centric |

OpenAI GPT Image 2 snapshot alias documented as **`gpt-image-2-2026-04-21`** (still current on 2026-08-01 model card). Cookbook prompting guide published **2026-04-21** remains the detailed prompting reference.

xAI Imagine remains the documented image path through `/v1/images/generations` with quality vs speed model tiers (no Jun–Aug changelog conflict found in fetched docs).

---

## 3. Two integration styles (industry)

### A — Dedicated Images endpoint (recommended spine for coding agents)

Call a **separate** image API from a **client tool** (`generate_image` / `edit_image`). Chat/agent model stays whatever the user selected (Claude, GPT, Gemini text, Ollama, …).

**Pros:** Works when chat provider cannot generate; clear cost attribution; easy to write bytes to workspace; matches AgentBrush / MCP pattern.  
**Cons:** Extra credentials routing; tool must choose image model/provider independently of chat model.

### B — Hosted tool inside the chat protocol

Example: OpenAI Responses `tools: [{ type: "image_generation" }]` so the **mainline** model decides when to call generation.

**Pros:** Multi-turn edit context, revised prompts, streaming partials, automatic prompt rewrite.  
**Cons:** OpenAI-only (for that exact tool); bills mainline **plus** image tokens; couples feature to Responses path; Anthropic/Gemini chat sessions cannot use this exact tool.

**VYOTIQ research recommendation:** Implement **A as the product spine** (workspace file tool). Optionally add **B** later as an OpenAI Responses accelerator when `thinkingApi === 'responses'` and the selected model supports the hosted tool — never as the only path.

---

## 4. Output delivery patterns

| Pattern | Who uses it | Agent implication |
|---------|-------------|-------------------|
| **Base64 in JSON** | OpenAI Images (default for GPT Image); Gemini Interaction `output_image.data`; xAI optional `b64_json` | Decode → write under workspace → return **path** to model/UI |
| **Temporary URL** | xAI default | Must download promptly; never persist URL as the only artifact |
| **Streaming partial images** | OpenAI Responses tool (`partial_images` 1–3) | Optional UX polish; not required for v1 tool |

---

## 5. Safety & policy (common)

- All major providers run **content moderation** on prompts and/or outputs.
- OpenAI: `moderation` = `auto` | `low`; blocked requests → `image_generation_user_error` / `moderation_blocked` — **do not blind-retry**.
- xAI: `respect_moderation` on SDK response — check before saving.
- Google: Prohibited Use Policy; rights to uploaded references; **SynthID** watermark on generated images.
- OpenAI: **API Organization Verification** may be required before GPT Image models work.

---

## 6. What “fully wired” means for P3 (preview)

A complete VYOTIQ feature is **not** “catalog shows gpt-image”. It is:

1. Agent-callable tool with schema + mode policy  
2. Provider adapters that actually return image bytes  
3. Safe write into the workspace (path policy + checkpoint/undo if mutating)  
4. Tool result that exposes path + mime + size (not a dead URL)  
5. UI/chat surfacing so the user can open the file  
6. Tests against mocked HTTP + one documented manual smoke path  

Details: [06-vyotiq-mapping-and-acceptance.md](./06-vyotiq-mapping-and-acceptance.md).
