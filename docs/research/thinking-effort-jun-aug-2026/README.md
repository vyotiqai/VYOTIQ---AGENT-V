# Thinking / reasoning effort research (Jun–Aug 2026)

**Research window:** Jun–Aug 2026 (compiled 2026-08-02)  
**Freeze status:** **freeze-ready** (draft integrity pass 2026-08-02). Documentation only until Phase B lands in product code.  
**Thesis:** Per-request thinking depth is a first-class control across frontier APIs. Product UIs must drive visibility and allowed levels from **live catalog metadata**, not hard-coded model ID tables.

## How to read

1. [00-source-inventory.md](./00-source-inventory.md) — source IDs, fetch dates, confidence  
2. [01-landscape-provider-contracts.md](./01-landscape-provider-contracts.md) — request/response shapes  
3. [02-effort-levels-and-mappings.md](./02-effort-levels-and-mappings.md) — unified ladder ↔ providers  
4. [03-behaviours-and-best-practices.md](./03-behaviours-and-best-practices.md) — real practices  
5. [04-ui-and-product-patterns.md](./04-ui-and-product-patterns.md) — product UX patterns  
6. [05-vyotiq-current-state.md](./05-vyotiq-current-state.md) — this repo’s inventory  
7. [06-preliminary-gap-findings.md](./06-preliminary-gap-findings.md) — evidence-backed gaps  
8. [07-catalog-capability-apis.md](./07-catalog-capability-apis.md) — **catalog discovery** (listModels fields)  
9. [sources.md](./sources.md) — annotated bibliography  

Local excerpts: [`_source-snapshot-notes-2026-08-02.txt`](./_source-snapshot-notes-2026-08-02.txt)

## Integrity rules

- Prefer **official provider docs** with fetch date 2026-08-02 over SEO blogs.  
- Labels: **Verified primary** · **Verified secondary** · **Date inferred** · **UNVERIFIED** · **Conflict — do not code against**.  
- Catalog fields beat ID heuristics when both exist.  
- Code over stale research when they disagree after Phase B ships.

## Phase B addendum (2026-08-02)

Product implementation is **catalog-driven**:

1. `listModels` / `normalizeOpenAiStyleModels` map OpenRouter `reasoning.*` (and similar signals) into `ModelInfo` thinking fields.
2. `ThinkingControls` shows/hides and filters efforts from `modelMeta` (catalog), with ID heuristics only when meta is missing.
3. Provider request builders coerce effort from `ModelInfo` and apply research `06` wire fixes (Anthropic adaptive 4.6+, Off→disabled/`none`, Groq exclusive fields, DeepSeek normalize, Ollama `providerId`).

Heuristics in `modelSupportsThinking` remain **fallback only** — do not expand them as the primary fix for new SKUs; prefer catalog fields.
