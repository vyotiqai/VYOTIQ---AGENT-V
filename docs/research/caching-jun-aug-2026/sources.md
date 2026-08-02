# Sources

**Research date:** 2026-08-02  
Authoritative IDs: [`00-source-inventory.md`](./00-source-inventory.md).

## Primary

| ID | Link | Use |
|----|------|-----|
| S1 | https://developers.openai.com/api/docs/guides/prompt-caching | OpenAI prompt cache, breakpoints, keys, TTL |
| S2 | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | Anthropic `cache_control`, TTL, prefix order |
| S3 | https://ai.google.dev/gemini-api/docs/caching | Gemini implicit/explicit context caching |
| S4 | https://openai.com/index/unrolling-the-codex-agent-loop/ | Prefix stability in agent loops |

## Secondary (in-repo)

| ID | Path | Use |
|----|------|-----|
| S5 | [`../04-best-practices-patterns.md`](../04-best-practices-patterns.md) | Existing project caching guidance |
| S6 | [`../agentic-adw-jun-aug-2026/11-tool-use-loop-behaviours.md`](../agentic-adw-jun-aug-2026/11-tool-use-loop-behaviours.md) | Loop + caching miss notes |

## Code evidence

| Area | Paths |
|------|-------|
| Prompt cache wiring | `src/main/agent/providers/anthropic.ts`, `openai.ts`, `openaiResponses.ts`, `gemini*.ts` |
| Assemble prefix | `src/main/agent/context/assemble.ts` |
| App caches | `modelCache.ts`, `gitStatusCache.ts`, `runListCache.ts`, `workspaceSnapshot.ts`, `tools/gitignore.ts`, … |

SEO multi-tier / Redis agent-cache blogs are **not** authoritative for this pack (see conflicts in `00`).
