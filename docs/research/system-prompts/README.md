# System-prompt & context-engineering research (Jun–Aug 2026)

**Research window:** June 2026 · July 2026 · August 2026 (plus still-current foundational docs that govern production behavior in this window)  
**Compiled:** 2026-08-01  
**Status:** Documentation only — no product code changes in this package  
**Purpose:** Concrete, source-backed reference for designing **true** production system prompts / harnesses for coding agents (VYOTIQ and peers). Use this before rewriting harness text or inventing new instruction surfaces.

## How to read this package

1. **[00-source-inventory.md](./00-source-inventory.md)** — what was fetched, when, confidence, and what is *not* claimed.
2. **[01-cross-provider-principles.md](./01-cross-provider-principles.md)** — durable rules that agree across OpenAI, Anthropic, and Google.
3. Provider deep-dives: **[02-openai](./02-openai-jun-aug-2026.md)** · **[03-anthropic](./03-anthropic-jun-aug-2026.md)** · **[04-google-gemini](./04-google-gemini-jun-aug-2026.md)**
4. **[05-coding-agent-patterns.md](./05-coding-agent-patterns.md)** — Cursor / Claude Code / agent-loop patterns that matter for harness authors.
5. **[06-security-prompt-injection.md](./06-security-prompt-injection.md)** — injection and privilege boundaries for system prompts.
6. **[07-vyotiq-mapping.md](./07-vyotiq-mapping.md)** — map findings onto VYOTIQ’s live harness + assembler (evidence-based).
7. **[08-checklist-and-templates.md](./08-checklist-and-templates.md)** — operator checklist + lean harness template.

## Companion product docs (already in repo)

- Operator summary: [docs/system-prompt-best-practices-2026.md](../../system-prompt-best-practices-2026.md)
- Live harness: [resources/harness/default.md](../../../resources/harness/default.md)
- Harness lifecycle: [docs/harness-handbook.md](../../harness-handbook.md)
- Assembly architecture: [docs/architecture.md](../../architecture.md)

## Integrity rules used while compiling

- Prefer **official** docs and first-party engineering blogs over SEO blogs.
- Label every claim as **Verified primary**, **Verified secondary**, or **Directional / needs local eval**.
- Keep **June–August 2026** sources separate from **pre-June foundations** that still apply.
- Never recommend stubs, marketing fluff, or “kitchen sink” prompts — mid-2026 consensus is leaner, outcome-first, progressive disclosure.

## Next product work (out of scope here)

Image generation tool (selected): use the dedicated research package **[../image-generation/README.md](../image-generation/README.md)** before any implementation. Other P3 items still need their own research + product approval. Do not implement features from this folder alone.
