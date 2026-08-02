# Existing caches map (VYOTIQ)

**Source:** Code (S7), verified 2026-08-02.  
**Rule:** Document only what ships. No new tiers.

## Provider (remote)

| What | Where | Hit when | Invalidate / miss when | Never put in cache key/prefix |
|------|-------|----------|------------------------|-------------------------------|
| Anthropic prompt cache | `providers/anthropic.ts` | Same `cache_control` prefix reused within TTL | Tool/system/message prefix bytes change | Volatile timestamps in marked static blocks |
| OpenAI prompt cache | `openai.ts`, `openaiResponses.ts` | Same `prompt_cache_key` + stable prefix / breakpoints | Key or prefix change; GPT-5.6 write policy | Changing suffix before explicit breakpoint |
| Gemini cached tokens | `gemini.ts`, `geminiInteractions.ts` | Implicit provider hit | Prefix drift | N/A (meter only) |

## Main process

| Cache | File | TTL / bound | Invalidate | Status |
|-------|------|-------------|------------|--------|
| Model catalog | `providers/modelCache.ts` | RAM 5m; disk 7d; generation token | `clearModelCache*` / secret change / expiry | **OK** |
| Git status | `git/gitStatusCache.ts` | 750ms + generation | Tools + git IPC | **OK** |
| Git binary probe | `git/git.ts` | 60s | Time | **OK** |
| List runs | `agent/runListCache.ts` | 3s | Status / run CRUD | **OK** |
| Workspace snapshot | `context/workspaceSnapshot.ts` | 30s + mtime fp | FS/git tools | **OK** |
| Rules | `context/rules.ts` | 30s + mtime fp | `clearRulesCache` / fp change | **OK** |
| System prefix | `context/assemble.ts` | Fingerprint | Input fingerprint change | **OK** |
| Tokenizer counts | `context/tokenizer.ts` | 4000 FIFO | Process / `resetTokenizerCache` | **OK** |
| Message token est. | `context/estimate.ts` | WeakMap | GC with message | **OK** |
| Slash command list | `slashCommands/listCache.ts` | 5s | MCP / install | **OK** |
| Workspace slash files | `slashCommands/workspaceCommands.ts` | 30s + mtime | `clearWorkspaceCommandsCache` | **OK** |
| MCP resolve | `marketplace/resolve.ts` | Fingerprint | Settings / marketplace | **OK** |
| Marketplace index | `marketplace/indexStore.ts` | Until write | Index write | **OK** |
| Remote catalog disk | `marketplace/catalog.ts` | Until refresh | Successful refresh | **OK** |
| Settings | `settings/settings.ts` | Until write | `writeSettings` | **OK** |
| Workspaces | `workspace/workspaces.ts` | Until write | Atomic write | **OK** |
| Custom image probe | `imageGen/customProbe.ts` | 30m | force / TTL | **OK** |
| OpenRouter image models | `imageGen/openrouterDiscovery.ts` | 1h global | clear / TTL | **Partial** — not keyed by API key (catalog usually shared; low risk) |
| Gitignore matchers | `tools/gitignore.ts` | Process lifetime | `clearGitignoreMatcherCache` via `invalidateAfterWorkspaceMutation` on FS/git tools | **Fixed** (2026-08-02) |
| MCP `toolsByName` | `mcp/index.ts` | On sync | `syncMcpServers` | **OK** |
| Per-run MCP catalog fp | `loop.ts` / `nestedAgent.ts` | Per run | Pin / config change | **OK** |
| Chromium disk cache | `app/chromiumProfile.ts` | Per build fingerprint | Rebuild | **OK** |

## Renderer

| Cache | File | Behavior | Status |
|-------|------|----------|--------|
| Provider catalog | `useProviderCatalogCache.ts` | Sticky success; error retry 30s | **OK** (may lag main TTL until refresh) |
| Highlight HTML | `MarkdownContent.tsx` | 200 FIFO; skip unstable stream fences | **OK** |
| Tool content | stream controller | Per run; cleared on suspend | **OK** |

## What must never enter durable / shared caches

- API keys / secrets (model cache keys use **hash** only)  
- Final LLM answers reused across workspaces  
- “Now” / session clock inside **stable** system-prefix fingerprint  
- Write results treated as immutable without invalidation  

## Audit snapshot (Phase 2)

| ID | Finding | Severity | Action |
|----|---------|----------|--------|
| C1 | `gitignore` `matcherCache` never cleared on FS mutations | P0 correctness | **Fixed** — `clearGitignoreMatcherCache` in `invalidateAfterWorkspaceMutation` |
| C2 | OpenRouter image discovery global (not per key) | P3 | Leave unless wrong catalog observed; optional key hash later |
| C3 | MCP tool-list change → provider prompt-cache miss | Expected (S4) | Document only |
| C4 | Unit coverage gaps (slash list, renderer catalog) | P2 tests | Prefer extend existing tests if touching those paths; not blockers for C1 |

**E2E note (Phase 3):** `tests/main/e2e/workspaceCacheInvalidation.test.ts` + `tests/main/unit/gitignoreSearch.test.ts` — **passed** 2026-08-02 (vitest). Also green: `gitStatusCache`, `modelCache`, `listRunsCache`, `workspaceSnapshotCache` unit suites.
