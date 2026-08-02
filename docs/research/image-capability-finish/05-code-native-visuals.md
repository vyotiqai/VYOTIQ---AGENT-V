# 05 — Code-native visuals (SVG, HTML/CSS UI, diagrams)

**Compiled:** 2026-08-01  
**Scope decision (locked):** Workspace artifacts authored by the agent — not a new ML model, not a remote render farm.  
**Confidence:** Directional for agent patterns; Verified primary where OpenRouter SVG / web platform apply.

---

## 1. Why this exists beside `generate_image`

Raster APIs excel at photorealism, illustration, mood, and loose UI mock photography. They are **weak** at:

- Exact spacing, grid alignment, and design-system tokens
- Accessible semantic structure
- Editable components engineers can ship
- Crisp vector icons at every DPI
- Deterministic diagrams from data

Coding agents already write files. Elevating **code-native visuals** makes “generate UI / sketch / icon / chart” fully functional without pretending every pixel needs GPT Image.

---

## 2. Artifact types

| Artifact | Format | When to use | Verify |
|----------|--------|-------------|--------|
| Icons / logos / illustrations (hard edges) | `.svg` | Brand marks, UI icons, simple posters | Open in browser / editor |
| Interactive or static UI screens | `.html` + CSS (single file preferred) | High-fidelity layout the user can click | Browser tools / snapshot |
| Diagrams | Mermaid `.md` or SVG | Architecture, flows | Preview / export |
| Data viz | SVG/HTML + JS or SVG from data | Charts with real numbers | Browser |
| Sketchy wireframes | SVG or HTML with wireframe CSS | Early product thinking | Browser |
| Photoreal / painterly | Raster via `generate_image` | Mood, hero art, photos | Tool card preview |

**OpenRouter note (Verified primary):** some Recraft-class models return `media_type: image/svg+xml` via Image API — hybrid path: generative **vector** bytes still go through image tool, then save as `.svg`.

---

## 3. Agent workflow patterns (Directional)

### A. Prefer code when the user says

“exact,” “production,” “match our design system,” “accessible,” “component,” “SVG icon,” “HTML mock,” “responsive.”

### B. Prefer raster when the user says

“photoreal,” “oil painting,” “cinematic,” “product photo,” “concept art,” “texture.”

### C. Hybrid

1. Raster moodboard → `generate_image`  
2. Rebuild layout in HTML/CSS for shippable UI  
3. Optional: `browser_snapshot` to compare

### D. File layout

Default suggestions (harness):

- `.vyotiq/generated/ui/*.html`
- `.vyotiq/generated/icons/*.svg`
- Or user paths under `docs/assets/`, `public/`, etc.

Reuse existing write tools (`edit`, `str_replace`, …). A dedicated `generate_visual` tool is **optional** if it only wraps path conventions + preview — do not invent a second editor.

---

## 4. Quality bar for code-native UI

From mid-2026 coding-agent practice (Directional) + OpenAI UI mock guidance (contrast):

| Rule | Detail |
|------|--------|
| One job | One screen / one icon set per deliverable |
| Real structure | Semantic HTML; labels; focus states |
| Tokens | CSS variables for color/type/spacing |
| No fake cards | Avoid decorative card chrome unless interactive |
| Motion | See [`08-motion-animations.md`](./08-motion-animations.md) — intentional 2–3 motions max |
| Assets | Inline SVG or relative paths; no broken CDN |
| Dark/light | Explicit if product needs both |

Avoid generic AI-layout tells (overused purple gradients, random stat strips) unless the user brand requires them.

---

## 5. Sketches “completely using code”

| Style | Technique |
|-------|-----------|
| Wireframe | Gray boxes, 1px borders, Inter-like system font only for wireframes |
| Pencil sketch | SVG stroke with jitter / roughjs-like paths (if dependency allowed) or hand-tuned polylines |
| Flat poster | SVG shapes + text |
| ASCII / monochrome | `.txt` or SVG text — rare |

Do not call raster APIs solely to approximate a wireframe the agent can draw in SVG in seconds.

---

## 6. Diagrams

- Prefer **source** Mermaid/Graphviz in markdown (editable) over opaque PNG.
- Rasterize only when the user needs a shareable bitmap (then browser export or future render helper).

---

## 7. Preview & acceptance

| Step | Mechanism |
|------|-----------|
| Write file | Existing file tools |
| Preview HTML/SVG | Electron browser tools or open path |
| Optional screenshot | `browser_snapshot` for chat evidence |
| Inline in tool card | Today’s `workspace:readImage` is raster-oriented; SVG/HTML may need “open file” / iframe preview (Directional product) |

---

## 8. Harness / system-prompt implications

Add explicit routing language:

- Use `generate_image` / `edit_image` for generative pixels.
- Use file tools for SVG/HTML/CSS/Mermaid when fidelity and editability matter.
- Never claim code-native output came from an image model.

---

## 9. Non-goals

- Bundling a headless Chromium PDF printer as required infra
- Replacing Figma
- Auto-converting every raster mock to React components without user ask
