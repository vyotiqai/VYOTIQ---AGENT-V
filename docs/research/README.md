# Research package index

**Package:** 2026 Provider & Capability Research  
**Research date:** 2026-08-01  
**Scope:** Codebase audit of VYOTIQ AGENT V’s LLM/agent stack, mid-2026 industry landscape, capability gaps, best practices, and a prioritized roadmap.

This package is **documentation only**. It does not change product behavior. Model IDs and prices churn quickly — prefer live provider catalogs at runtime and treat seed recommendations as planning input.

## Documents

| Doc | Contents |
|-----|----------|
| [01-current-state-audit.md](./01-current-state-audit.md) | What VYOTIQ ships today (providers, protocols, tools, modes, context, MCP, skills) |
| [02-provider-model-landscape-2026.md](./02-provider-model-landscape-2026.md) | Frontier labs, specialists, enterprise gateways, coding-agent patterns |
| [03-capability-gap-analysis.md](./03-capability-gap-analysis.md) | Have / Partial / Missing matrices + seed freshness |
| [04-best-practices-patterns.md](./04-best-practices-patterns.md) | Integration, caching, tools/MCP, context, multi-agent patterns |
| [05-prioritized-roadmap.md](./05-prioritized-roadmap.md) | P0–P3 implementation recommendations mapped to files |
| [sources.md](./sources.md) | Annotated bibliography |
| [image-generation/](./image-generation/README.md) | Jun–Aug 2026 image-gen APIs / Slice A–C research (product now ships) |
| [image-capability-finish/](./image-capability-finish/README.md) | **Jun–Aug 2026** audit-finish: HQ, OpenRouter/custom, code-native/motion (F0–F5 shipped; `generate_video` deferred) |
| [system-prompts/](./system-prompts/README.md) | System-prompt / harness instruction research (docs only) |
| [agentic-adw-jun-aug-2026/](./agentic-adw-jun-aug-2026/README.md) | ADW framing (≈ Jul 2026) + still-governing earlier-2026 labs; [tool-loop](./agentic-adw-jun-aug-2026/11-tool-use-loop-behaviours.md); [source integrity](./agentic-adw-jun-aug-2026/10-source-integrity.md) — **freeze-ready** (2026-08-02); VYOTIQ mapping + audit |
| [caching-jun-aug-2026/](./caching-jun-aug-2026/README.md) | **Jun–Aug 2026** provider prompt-cache + **existing** app caches map; harden-only (no new tiers) — freeze-ready 2026-08-02 |
| [thinking-effort-jun-aug-2026/](./thinking-effort-jun-aug-2026/README.md) | **Jun–Aug 2026** thinking/reasoning effort contracts, catalog discovery, VYOTIQ gaps — freeze-ready 2026-08-02; Phase B = catalog-driven `ModelInfo` |
| [token-cost-jun-aug-2026/](./token-cost-jun-aug-2026/README.md) | **Jun–Aug 2026** token/cost practices + VYOTIQ burn audit; cumulative billed-input telemetry + soft-cap hold (shipped) |

## How to use

1. Start with **01** if you need an accurate inventory of this repo.
2. Read **03** for “what are we missing?”
3. Use **05** when proposing implementation work — ask before expanding scope.
4. Cite **sources** when recommending protocol or provider changes.

## Related product docs

- [Architecture](../architecture.md)
- [Harness handbook](../harness-handbook.md)
- [System prompt best practices 2026](../system-prompt-best-practices-2026.md)
- [README](../../README.md)
