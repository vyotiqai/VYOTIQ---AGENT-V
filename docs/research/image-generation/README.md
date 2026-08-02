# Image generation research (Jun–Aug 2026)

**Research window:** June 2026 · July 2026 · August 2026 (plus still-current official docs governing behavior in this window)  
**Compiled:** 2026-08-01  
**Status:** Research package retained for API/prompting history. **Product code now ships** (`generate_image` / `edit_image`). For audit-finish, HQ params, OpenRouter/custom, code-native visuals, and motion, use **[../image-capability-finish/](../image-capability-finish/)**.  
**Selected product target:** P3 **Image generation tool** (Slice A–C implemented; finish work gated on the capability-finish package)

## Purpose

Concrete, source-backed reference for designing a **real** image-generation capability in a coding agent (VYOTIQ): APIs, models, prompting, safety, file I/O, and agent-tool architecture. Prefer this package over training memory or blog roundups when implementing.

## How to read

1. **[00-source-inventory.md](./00-source-inventory.md)** — what was fetched, confidence labels, unresolved conflicts  
2. **[01-landscape-jun-aug-2026.md](./01-landscape-jun-aug-2026.md)** — cross-provider matrix + timeline  
3. **[02-openai-deep-dive.md](./02-openai-deep-dive.md)** — Image API vs Responses `image_generation` tool; GPT Image 2  
4. **[03-google-gemini-deep-dive.md](./03-google-gemini-deep-dive.md)** — Nano Banana / Gemini image models; Imagen deprecation  
5. **[04-xai-and-others.md](./04-xai-and-others.md)** — xAI Imagine; Anthropic (no gen); aggregators  
6. **[05-agent-integration-patterns.md](./05-agent-integration-patterns.md)** — coding-agent tool patterns, workspace writes, edits  
7. **[06-vyotiq-mapping-and-acceptance.md](./06-vyotiq-mapping-and-acceptance.md)** — map onto this repo + acceptance criteria for a full implementation  
8. **[sources.md](./sources.md)** — annotated bibliography

## Integrity rules

- Prefer **official** docs (OpenAI Developers, Google AI for Developers, xAI docs, Anthropic platform) over SEO blogs.
- Label claims: **Verified primary** · **Verified secondary** · **Directional / needs local eval** · **Conflict — do not code against yet**.
- Keep June–August 2026 chronology explicit (Gemini changelog entries, OpenAI cookbook dated 2026-04-21 still governing GPT Image 2 as of compile).
- Do **not** implement stubs from this folder. Implementation requires an approved plan that cites these docs and ships end-to-end.

## Related packages

- **Finish / expand research (2026-08-01):** [../image-capability-finish/](../image-capability-finish/)  
- Broader capability research: [../README.md](../README.md)  
- System-prompt research: [../system-prompts/README.md](../system-prompts/README.md)  
- Roadmap P3 row: [../05-prioritized-roadmap.md](../05-prioritized-roadmap.md)
