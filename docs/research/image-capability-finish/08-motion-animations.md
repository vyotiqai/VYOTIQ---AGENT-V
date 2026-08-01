# 08 — Motion & animations

**Compiled:** 2026-08-01  
**Tracks:** (A) Code-native motion for UI/sketches · (B) Provider video/motion APIs  
**Out of scope:** Chat tool-card entrance chrome as a substitute for capability.

---

## 1. Decision framework

| Need | Use |
|------|-----|
| Micro-interactions, loaders, UI polish in a mock | **Code-native** CSS / SVG / WAAPI in `.html` / `.svg` |
| Short generative clip from text or still | **Provider video** (xAI Imagine video — Verified primary) |
| Animated generative “GIF-like” still morph | Prefer video API or CSS; do not assume OpenAI Images returns animated GIF (not documented as primary) |
| Logo hover / icon pulse | SVG + CSS |

---

## 2. Code-native motion (primary for coding agents)

### Verified platform primitives (MDN)

**CSS Animations**

- Configure with `animation-*` or `animation` shorthand
- Define sequences with `@keyframes` (`from`/`to` or percentages)
- Control: duration, timing-function, iteration-count, direction (`alternate`), delay, fill-mode, play-state
- Prefer animating `transform` and `opacity` (compositor-friendly) over layout properties (`width`, `top`, `font-size`)
- Events: `animationstart`, `animationiteration`, `animationend` for sequencing

**CSS Transitions**

- Better for state-driven UI (hover, open/close) than long scripted timelines

**Web Animations API**

- Imperative control, timeline scrubbing, coordination from JS — use when CSS alone is awkward

### Agent best practices (Directional)

1. **Budget:** 2–3 intentional motions per screen; no noise.
2. **Duration:** 150–300ms UI feedback; 400–800ms entrance; avoid infinite distraction unless a true loader.
3. **Easing:** `ease-out` for entrances; `ease-in-out` for loops; respect `prefers-reduced-motion: reduce` (disable or simplify).
4. **SVG:** CSS transforms on groups; SMIL is legacy — prefer CSS/WAAPI.
5. **Accessibility:** Never convey unique information by motion alone; provide text/state.
6. **Deliverable:** Self-contained HTML demo under `.vyotiq/generated/` or project `docs/` so the user can open it.

### Example patterns to document in harness (not implement here)

- Button press scale
- Staggered list fade-in
- Skeleton shimmer (careful with reduced motion)
- SVG path draw-on for diagrams
- Page section reveal on scroll (Intersection Observer + CSS)

---

## 3. Provider motion / video — xAI (Verified primary)

Prior research marked video “out of scope.” **Re-verified 2026-08-01:** xAI Imagine documents full video capabilities.

### Models

| Model | Notes |
|-------|-------|
| `grok-imagine-video-1.5` | Current; 1080p on T2V/I2V; reference-to-video caps lower (720p per docs) |
| `grok-imagine-video` | Earlier / cheaper per-second tier |

### API shape

- `POST https://api.x.ai/v1/videos/generations` → `{ request_id }`
- Poll `GET /v1/videos/{request_id}` until `done` | `failed` | `expired`
- Params: `prompt`, `model`, `duration` (1–15s, default ~8), `aspect_ratio`, `resolution` (`480p`\|`720p`\|`1080p`), optional `image` for I2V, `reference_images` / `reference_audios` for R2V
- Pricing: per-second (docs table ~$0.05–$0.08/sec depending on model)

### Modes

Text-to-video · Image-to-video · Reference-to-video · Video editing · Video extension

### VYOTIQ mapping recommendation

| Item | Recommendation |
|------|----------------|
| Tool | Separate `generate_video` (do **not** overload `generate_image`) |
| Settings | Explicit enable; default off until UX for async jobs exists |
| Progress | Poll phases → download to `.vyotiq/generated/video/` |
| Preview | Video element in tool card (new IPC) — larger than image preview |
| Chat provider independence | Same as images (xAI key) |

### Other providers

| Provider | Motion/video gen | Notes |
|----------|------------------|-------|
| OpenAI | Separate **Video generation** nav exists on docs site | Not deep-dived this pass for Sora-class APIs — **Directional follow-up** before claiming |
| Gemini | Image-focused Nano Banana docs | No Verified primary “generate video” in the image guide fetched |
| OpenRouter | Image API + separate Video Generation docs link | Treat video as another media API if/when researched |
| Anthropic | None | Vision only |

---

## 4. Format matrix

| Format | How produced | Preview |
|--------|--------------|---------|
| CSS/SVG animation | Agent-written HTML/SVG | Browser |
| GIF/APNG | Rare; not primary OpenAI Images output | Image/video viewers |
| MP4/WebM | xAI video URL download | `<video>` |
| Lottie JSON | Only if user stack already uses Lottie (Directional) | Player |

---

## 5. Conflicts & cautions

- **C2:** Video is real on xAI — prior “out of scope” was product choice, not API absence.
- Do not stream-bill confusion: still-image OpenRouter all-or-nothing ≠ video async jobs.
- Infinite CSS loops in committed product UI need reduced-motion escapes.
- Generating video is cost- and latency-heavy; require Agent mode + approval like other mutating tools.

---

## 6. Acceptance criteria (future implement)

### Code-native motion

- [x] Harness section: when to animate in HTML/SVG vs call video API (`resources/harness/default.md` Motion + Visuals)
- [x] Example deliverable path conventions (`.vyotiq/generated/ui|icons/`)
- [ ] Optional: preview HTML in tool UI / “Open preview” (still Directional)

### Provider video

- [ ] Research deep-dive addendum if OpenAI video is productized  
- [ ] `generate_video` schema + xAI adapter + poll + workspace write  
- [ ] Settings gate + dry-run in Ask/Plan  
- [ ] Tests with mocked async lifecycle
