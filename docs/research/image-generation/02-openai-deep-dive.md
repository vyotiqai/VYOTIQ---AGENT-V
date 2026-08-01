# 02 — OpenAI image generation deep dive

**Compiled:** 2026-08-01  
**Primary sources:** [Image generation guide](https://developers.openai.com/api/docs/guides/image-generation), [Image generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation), [GPT Image 2 model](https://developers.openai.com/api/docs/models/gpt-image-2), [Prompting cookbook 2026-04-21](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)

---

## 1. Two APIs (official guidance)

| Need | Use |
|------|-----|
| Single generate/edit from one prompt | **Image API** (`/v1/images/generations`, `/v1/images/edits`) |
| Conversational multi-turn generate/edit with tool loop | **Responses API** + built-in tool `type: "image_generation"` |

With Image API you pick the **GPT Image** model (`gpt-image-2`, …).  
With Responses tool you pick a **mainline** chat model; the tool selects a GPT Image model internally. Responses bills **mainline tokens + image tokens**.

---

## 2. Models (as of 2026-04-21 cookbook; still current 2026-08-01)

| Model | Quality | `input_fidelity` | Resolutions | Role |
|-------|---------|------------------|-------------|------|
| **`gpt-image-2`** | low / medium / high | **Disabled** (always high-fidelity inputs) | Flexible sizes meeting constraints | **Default for new builds** |
| `gpt-image-1.5` | low / medium / high | low / high | Fixed set + `auto` | Migration / validated workflows |
| `gpt-image-1` | low / medium / high | low / high | Fixed set + `auto` | Legacy only |
| `gpt-image-1-mini` | low / medium / high | low / high | Fixed set + `auto` | Cost / batch drafts |

Snapshot alias: **`gpt-image-2-2026-04-21`**.

**DALL·E:** Official mid-2026 guides center on **GPT Image**, not DALL·E 3, for new work. VYOTIQ already filters `dall-e` from chat catalogs via `NON_CHAT`.

---

## 3. Image API — generate behavior

- Endpoint: `POST /v1/images/generations`
- Typical response: **`b64_json`** (save to disk in agents)
- Parameter `n`: multiple images per request (default 1)
- Org may need **API Organization Verification** before GPT Image works

### Customize output (Verified primary)

| Option | Values / notes |
|--------|----------------|
| `size` | `auto` default; popular: `1024x1024`, `1536x1024`, `1024x1536`, 2K/4K examples; **flexible** for `gpt-image-2` under constraints |
| `quality` | `low` \| `medium` \| `high` \| `auto` — start with **`low`** for drafts |
| Format | Default **png**; also `jpeg`, `webp` |
| `output_compression` | 0–100 for jpeg/webp |
| `background` | opaque / auto; **`transparent` not supported on `gpt-image-2`** |
| `moderation` | `auto` (default) \| `low` |

### `gpt-image-2` size constraints (Image generation guide)

- Max edge **≤ 3840px** (see Conflict C2 in `00-source-inventory` vs cookbook `< 3840`)
- Both edges multiple of **16**
- Aspect ratio long:short **≤ 3:1**
- Total pixels **655,360 … 8,294,400**
- Above **2560×1440** (~2K) treated as **experimental**

### Latency & limits

- Complex prompts: up to **~2 minutes**
- Still imperfect: tiny text placement, character consistency across many gens, pixel-perfect layout

### Errors

- Transient: retry `429` / `5xx`
- User errors: `error.type = "image_generation_user_error"` — **change prompt/inputs**, do not auto-retry
- Moderation: `error.code = "moderation_blocked"` (+ optional `moderation_details`)

### Edits

- `/v1/images/edits` for full/partial edits; optional **mask** (same format/size as image; &lt; 50MB)
- For `gpt-image-2`, omit `input_fidelity` (not configurable)

---

## 4. Responses hosted tool — `image_generation`

### Call shape

```json
{
  "model": "gpt-5.6",
  "input": "Generate an image of …",
  "tools": [{ "type": "image_generation", "action": "generate" }]
}
```

Tool result item: `type: "image_generation_call"` with `result` (base64), optional `revised_prompt`, `id` for follow-ups.

### Tool options

`size`, `quality`, `format`, `compression`, `background`, `action` (`auto` | `generate` | `edit`), `partial_images` (1–3 for streaming).

- Force tool: `tool_choice: { "type": "image_generation" }`
- Force edit without an image in context → **error**; leave `action: auto` when unsure
- Prompt tip: prefer verbs **`draw` / `edit`** over vague “combine/merge”

### Multi-turn

- `previous_response_id`, or re-inject prior `image_generation_call` by `id`
- Mainline model **revises** prompts (`revised_prompt`)

### Streaming

Event `response.image_generation_call.partial_image` with `partial_image_b64` / index; final on `response.completed`.

### Supported mainline models (fetched tools page)

Listed: `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.2`, `gpt-5`, `gpt-5-nano`, `o3`, `gpt-4.1`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o`, `gpt-4o-mini`.  
Examples use **`gpt-5.6`** — treat as Conflict C3; verify model cards at implement time.  
**GPT Image model IDs are not valid** as Responses `model`.

---

## 5. Prompting practices (cookbook, production-tested)

**Structure:** background/scene → subject → details → constraints; state intended use (ad, UI mock, icon, infographic).

**Quality levers:** say “photorealistic” explicitly when needed; don’t over-specify camera EXIF.

**Latency:** ship drafts at `quality: "low"`; escalate for dense text, identity, final assets.

**Text in image:** put literals in quotes or ALL CAPS; letter-spell brand names; use medium/high for small type.

**Edits:** “change only X” + “keep everything else the same”; repeat preserve list each turn.

**Multi-image:** reference by index (“Image 1… Image 2…”) and describe interactions.

**Iterate:** small single-change follow-ups beat overloaded mega-prompts for debugging.

---

## 6. Org verification (ops)

OpenAI Help Center: Settings → Organization → General → **Verify Organization**. Needs government ID + live face match; not the same as usage tier. GPT Image access may fail until verified and propagated (often minutes; community reports suggest re-issuing keys if stuck).

**Product implication:** Surface a clear error when the API returns verification-related failures; link to OpenAI’s verification help article — do not silently fall back to a fake local placeholder image.
