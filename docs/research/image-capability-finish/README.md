# Image capability finish — research (Jun–Aug 2026)

**Research window:** June 2026 · July 2026 · August 2026  
**Compiled:** 2026-08-01  
**Status:** Research retained as source of truth. **Product:** F0–F5 shipped (HQ, OpenRouter, custom probe, code-native/motion harness). Optional `generate_video` still deferred.  
**Purpose:** Audit the shipped `generate_image` / `edit_image` stack; document every verified provider/model surface; capture HQ/prompting practice; define code-native visuals and motion/animation paths.

## How to read

1. **[00-source-inventory.md](./00-source-inventory.md)** — URLs, confidence, conflicts  
2. **[01-current-vyotiq-audit.md](./01-current-vyotiq-audit.md)** — what ships today vs gaps  
3. **[02-provider-model-matrix-2026.md](./02-provider-model-matrix-2026.md)** — who can generate; model IDs; auto-route rules  
4. **[03-hq-params-and-prompting.md](./03-hq-params-and-prompting.md)** — high-res/HQ params + prompting (UI, sketch, art)  
5. **[04-openrouter-custom-compat.md](./04-openrouter-custom-compat.md)** — OpenRouter Image API + custom hosts  
6. **[05-code-native-visuals.md](./05-code-native-visuals.md)** — SVG / HTML / diagrams vs raster  
7. **[06-routing-and-capability-detection.md](./06-routing-and-capability-detection.md)** — chat ≠ image provider  
8. **[07-vyotiq-finish-mapping.md](./07-vyotiq-finish-mapping.md)** — phased acceptance for a future implement plan  
9. **[08-motion-animations.md](./08-motion-animations.md)** — CSS/SVG/WAAPI + xAI video  
10. **[sources.md](./sources.md)** — annotated bibliography  

## Integrity rules

- Prefer **official** docs over SEO blogs.
- Label claims: **Verified primary** · **Verified secondary** · **Directional** · **Conflict**.
- Implementation cites [`07-vyotiq-finish-mapping.md`](./07-vyotiq-finish-mapping.md). F0–F5 (except optional `generate_video`) are in product code / harness.

## Related

- Prior raster research (Slice A–C): [`../image-generation/`](../image-generation/)  
- Roadmap: [`../05-prioritized-roadmap.md`](../05-prioritized-roadmap.md)  
- Broader research index: [`../README.md`](../README.md)
