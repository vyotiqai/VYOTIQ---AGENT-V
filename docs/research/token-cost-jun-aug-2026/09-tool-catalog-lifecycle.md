# Tool catalog lifecycle (stay vs drop)

**Date:** 2026-08-02  
**Status:** Code-verified + product change (idle TTL / explicit release)  
**Related:** [`08-reduction-recommendations.md`](./08-reduction-recommendations.md), [`04-vyotiq-token-burn-audit.md`](./04-vyotiq-token-burn-audit.md)

## Verified before unload

| Artifact | Stayed for run? | Dropped when? |
|----------|-----------------|---------------|
| Pinned MCP schemas (after sticky admit) | **Yes** (immortal for the run) | Run end, server disabled, Ask/Plan mode |
| Unpinned MCP | Never admitted (`deferUnpinnedMcp`) | N/A |
| Optional builtins shed on first fresh trim | No | Sticky would not re-admit |
| Skill full body | No | Stubbed after follow-up messages |
| Tool **results** in history | Trimmed under pressure | Separate from tool *definitions* |

Pinned MCP were append-admitted into the sticky catalog and **never unpinned**. Industry note: Claude Code deferred tools similarly stay loaded for the session (unload requested upstream).

**API requests:** One `provider.streamChat` per agent step. Multipliers: stream retries, nested subagent steps, optional compaction LLM, truncation continues.

## Product change (this engagement)

Pinned MCP schemas are no longer immortal for the whole run:

1. **Idle TTL** — unused pinned MCP (no invoke/pin refresh for `MCP_PIN_IDLE_TTL_STEPS` = **16**, tuned from AppData `80bd4074` read/terminal bursts) are evicted from the sticky catalog.
2. **Soft max** — at most `MCP_PINNED_SOFT_MAX` pinned MCP stay in the step catalog; excess are LRU-evicted.
3. **`release_mcp_tools`** — agent can explicitly unpin; next step omits those schemas (re-pin anytime).
4. **Resume** — `toolCatalog.json` stores `mcpLastUsedByName` so idle TTL survives restart (legacy files without stamps seed to the resume step).
5. **Telemetry** — each eviction logs `Evicted idle/excess pinned MCP from sticky catalog` with `code: TOKEN_COST` (search AppData agent logs).

Required builtins are never evicted. Capability is preserved via re-pin (`request_mcp_tools`).

## Further cost levers (same engagement)

- **GPT-5.6+**: second explicit `prompt_cache_breakpoint` on the last cacheable history item before volatile session context (never on `function_call_output`).
- **Anthropic**: server `clear_tool_uses_20250919` with window-scaled `trigger` and `clear_at_least: 5000` so clears do not thrash the prompt cache.

## User levers (no code)

- `/clear` between unrelated tasks (Σ cost = steps × window)
- Lower thinking effort when not needed
- Disable unused MCP servers / allow-deny lists
- Cheaper `subagentModel` for research forks
