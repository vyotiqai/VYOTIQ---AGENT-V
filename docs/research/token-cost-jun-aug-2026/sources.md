# Sources

**Research date:** 2026-08-02 (Phase 1 refresh)  
Authoritative IDs: [`00-source-inventory.md`](./00-source-inventory.md).  
Snapshot: [`_source-snapshot-notes-2026-08-02.txt`](./_source-snapshot-notes-2026-08-02.txt).

## Primary

| ID | Link | Use |
|----|------|-----|
| T1 | https://developers.openai.com/api/docs/guides/prompt-caching | OpenAI prompt cache (incl. GPT-5.6+ breakpoints) |
| T2 | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | Anthropic cache_control |
| T3 | https://platform.claude.com/docs/en/build-with-claude/context-editing | Tool-result / thinking clearing |
| T4 | https://platform.claude.com/cookbook/tool-use-context-engineering-context-engineering-tools | Compaction + clearing cookbook |
| T5 | https://docs.anthropic.com/en/docs/claude-code/costs | Coding-agent cost practices |
| T6 | https://ai.google.dev/gemini-api/docs/caching | Gemini caching (implicit / explicit) |
| T7 | https://api-docs.deepseek.com/news/news0802/ | DeepSeek disk context caching (mechanism) |
| T8 | https://openai.com/index/unrolling-the-codex-agent-loop/ | Agent-loop prefix stability |
| T13 | https://claude.com/blog/lessons-from-building-claude-code-prompt-caching-is-everything | Claude Code `defer_loading` + cache-safe compaction |

## Secondary

| ID | Link / path | Use |
|----|-------------|-----|
| T9 | https://arxiv.org/abs/2601.06007 | Cache strategy evaluation |
| T10 | [`../caching-jun-aug-2026/`](../caching-jun-aug-2026/) | VYOTIQ cache wiring |
| — | https://code.claude.com/docs/en/prompt-caching | Claude Code product caching UX (cross-check T5/T13) |

## Code / AppData (Phase 2+)

| ID | Path | Use |
|----|------|-----|
| T11 | `src/main/agent/**`, `src/shared/utils/runTelemetry.ts` | Loop, assemble, telemetry |
| T12 | AppData sessions under `%APPDATA%/vyotiq` | Measured Σ burn (live `80bd4074-…`) |
