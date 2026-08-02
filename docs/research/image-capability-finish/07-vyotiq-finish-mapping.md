# 07 — VYOTIQ finish mapping & acceptance

**Compiled:** 2026-08-01  
**Status:** F0–F5 harness/product complete for first-party + OpenRouter + custom probe + code-native/motion harness. Optional `generate_video` remains deferred until product approves async video UX.

**Inputs:** [`01`](./01-current-vyotiq-audit.md)–[`06`](./06-routing-and-capability-detection.md), [`08`](./08-motion-animations.md)

---

## 1. Goal statement

Finish the image capability so it is **fully wired** for:

1. All **verified** image-generation providers VYOTIQ can reach (first-party OpenAI/Gemini/xAI + OpenRouter + optional custom).
2. **HQ / high-res** parameters and prompting defaults.
3. **Code-native** SVG/HTML/diagram paths for UI/sketches that should not be faked as raster.
4. **Motion** via code-native CSS/SVG first; optional xAI **video** as a separate gated tool.

---

## 2. Phased implementation (recommended order)

### Phase F0 — Audit hardening (first-party)

| Work | Primary files |
|------|----------------|
| Expose `output_format`, `output_compression`, `background`, `n` on tools + OpenAI adapter | `tools.ts`, `openai.ts`, `types.ts` |
| Validate OpenAI size constraints before HTTP | new helper + `openai.ts` |
| Gate transparent background off for `gpt-image-2` | `openai.ts` |
| Pass format through mime/extension on write | `generateImage.ts`, `editImage.ts` |
| Gemini: document/support `0.5K`; optional `gemini-3-pro-image` in settings hints | `AgentSection.tsx`, harness |
| xAI: allow `grok-imagine-image` speed default via settings; clamp invalid `4K` still | `xai.ts` |
| Tests for validators + new args | `generateImage.test.ts` |

**Acceptance:** Agent can request 2K/4K (within provider rules), jpeg/webp, n>1 (OpenAI), and get clear errors on illegal sizes.

### Phase F1 — Routing completeness

| Work | Primary files |
|------|----------------|
| Composer/settings capability hint (“Image ready: …”) | settings UI / composer |
| Harness: chat provider ≠ image provider; draft vs final presets | `resources/harness/default.md` |
| Presets `draft` \| `final` mapping to quality/resolution | tools + adapters |

**Acceptance:** Anthropic chat + Gemini key works without user specifying provider; error copy names missing keys.

### Phase F2 — OpenRouter Image API

| Work | Primary files |
|------|----------------|
| `openrouter` image adapter via `/api/v1/images` | `providers/imageGen/openrouter.ts` |
| Discovery cache for models/params | `openrouterDiscovery.ts` |
| Settings + schema enum expansion | `settings.ts`, `tools.ts` |
| SVG mime → `.svg` write | tool write path + `mime.ts` |
| Tests with mocked discovery + generate | unit tests |

**Acceptance:** Only OpenRouter key configured → `generate_image` succeeds for a discovered model.

**Status:** Implemented.

### Phase F3 — Custom OpenAI-compat images

| Work | Primary files |
|------|----------------|
| Injectable base URL on OpenAI adapter | `openai.ts` |
| `customImageEnabled` + probe | settings + router |
| Document failure modes | README / architecture |

**Acceptance:** Enabled custom host with working `/v1/images/generations` generates; disabled or 404 probe does not break auto-route.

**Status:** Implemented.

### Phase F4 — Code-native visuals

| Work | Primary files |
|------|----------------|
| Harness routing rules (raster vs SVG/HTML) | `default.md` |
| Optional path conventions under `.vyotiq/generated/` | docs + harness |
| Preview story for SVG/HTML (open / simple preview) | toolUi Directional |
| No mandatory new tool if file tools suffice | product call |

**Acceptance:** User asks for “exact SVG icon” → agent writes SVG without unnecessary image API call (eval / rubric).

**Status:** Implemented via harness + architecture (file tools; `.vyotiq/generated/icons|ui/` paths; no dedicated visual tool).

### Phase F5 — Motion

| Work | Primary files |
|------|----------------|
| Harness: CSS/SVG motion budget + `prefers-reduced-motion` | `default.md` |
| Optional later: `generate_video` + xAI async poll adapter | new tool + `videoGen/` |
| Settings gate for video | settings |
| Tool card `<video>` preview IPC | renderer + main |

**Acceptance:** Animated HTML mock delivered with 2–3 motions; video tool (if approved) writes file after poll `done`.

**Status:** Code-native motion harness shipped. `generate_video` still deferred.
### Explicitly deferred

- OpenAI Responses hosted `image_generation` as second spine (client tools already sufficient)
- OpenAI `partial_images` streaming (status phases already ship)
- OpenAI Sora-class video until dedicated research addendum
- rembg / local bg-remove

---

## 3. Gap → file map (quick)

| Gap | Files |
|-----|-------|
| HQ args | `schemas/tools.ts`, `imageGen/types.ts`, adapters, tool writers |
| OpenRouter | new adapter, `index.ts` router, settings, secrets reuse |
| Custom images | `openai.ts` baseUrl, settings, resolveImageGenProvider |
| Routing UX | `AgentSection.tsx`, composer meter/badge Directional |
| Code-native | harness, maybe toolUi preview |
| Video | new tool surface + async job UX |
| Docs drift | `docs/research/image-generation/README.md`, roadmap P3 row, `architecture.md` |

---

## 4. Global acceptance checklist

- [ ] Manual smoke: OpenAI / Gemini / xAI / OpenRouter live keys (2026-08-02: script `scripts/image-live-smoke.cjs`; only OpenAI key present → HTTP 401 invalid_api_key; Gemini/xAI/OpenRouter skipped — no saved keys)
- [x] F0 HQ params + size validation tests green
- [x] F1 Anthropic-chat + other-provider-image path documented + tested
- [x] F2 OpenRouter path (if approved)
- [x] F3 custom probe (if approved)
- [x] F4 harness routes code-native vs raster correctly
- [x] F5 motion harness (+ video only if product approves) — harness done; video deferred
- [x] No false claims for Anthropic/Ollama image gen
- [x] Architecture + roadmap updated after implement

---

## 5. Integrity

Implement **one phase at a time**, fully wired (schema → adapter → tool → UI → tests → build). Prefer citing this package in the implement plan over improvising APIs.
