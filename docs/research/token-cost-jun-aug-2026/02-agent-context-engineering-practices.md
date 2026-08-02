# Agent context-engineering practices (Jun–Aug 2026)

**Sources:** T3–T5, T8–T9, T13; cross-link thinking / ADW / caching packs.  
**Refresh:** 2026-08-02. Practice IDs below are for Phase 4 citation (`P-…`).

## Practice index

| ID | Practice | Primary |
|----|----------|---------|
| P-LOOP | Treat cost as Σ step inputs (+ reasoning), not one meter | T5, T8, T13 |
| P-PREFIX | Stable instruction + tools prefix; volatile last | T1, T2, T8, T13 |
| P-MSG-UPD | Prefer message/tool-result updates over editing stable system | T13 |
| P-TRIM | Clear/stub old tool results; keep last N full | T3, T4, T5 |
| P-COMPACT | Compact deliberately; hold window after; cache-safe fork | T4, T5, T13 |
| P-CLEAR | `/clear` or new chat at task boundaries | T5 |
| P-DEFER | Defer MCP/tools (stubs) instead of remove mid-run | T5, T13 |
| P-NO-CHURN | Do not reshuffle tools or switch models mid-session casually | T8, T13 |
| P-THINK | Thinking/effort is paid; surface it; no silent downgrade | T5 |
| P-NEST | Subagents multiply stacks; attribute + prefer cheap workers | T5 |
| P-OBS | Meter per-step + Σ billed input, cache %, hotspot layers | T5, T13 |
| P-HITRATE | Treat cache hit rate as an operational metric | T13 |

## 1. Treat cost as step-loop economics (P-LOOP)

Every assistant turn that calls tools becomes another full prompt. Reducing **tokens per step** and **steps that re-send dead history** both matter. Step ceilings as a product kill-switch are out of scope for VYOTIQ (project rule); prefer context pressure + user abort + clear sessions (T5).

## 2. Stable instruction prefix (P-PREFIX, P-MSG-UPD, P-NO-CHURN)

- Compile harness, rules, skill *metadata*, and tool schemas as a stable leading block.
- Put clocks, git snapshots, loop hints, and live memory in a **volatile tail** so they do not bust the cacheable prefix (T1, T2, T8, T9, T13).
- Prefer pushing updates (time, plan mode, file change notices) into **messages / tool results**, not rewriting the stable system (T13).
- Do not reorder tools mid-run unless the catalog actually changed (T8, T13).

## 3. Tool results: clear, do not hoard (P-TRIM)

- Keep only the last few tool results verbatim; stub older ones with a re-read hint (T3, T4).
- Prefer on-demand `read`/`grep` over stuffing large files into durable history (T5).
- Server-side clearing (Anthropic context editing) complements client trim when available (T3).

## 4. Compaction vs clear (P-COMPACT, P-CLEAR)

| Action | When | Cost note |
|--------|------|-----------|
| Compaction / summarize | Context near trigger; need continuity | Compaction call itself is large (T5). Cache-safe fork = same system+tools as parent (T13) |
| `/clear` or new chat | Task boundary; stale context | Zero history tokens thereafter (T5) |

Compaction must **hold** the working set near the trigger afterward; otherwise you pay for summarize *and* keep re-billing a huge window.

## 5. MCP / tool schemas (P-DEFER)

- Tool JSON is paid on every step that sends tools (T5).
- Defer unused MCP tools via lightweight stubs (`defer_loading` pattern) rather than removing them mid-conversation (T13); expose recovery (`request_mcp_tools` / pin / tool search) so models can pull needed schemas (T5).
- Prefer CLI when equivalent (T5 Claude Code guidance) — fewer always-on schemas.

## 6. Thinking / effort (P-THINK)

- Higher effort → more reasoning tokens every step (thinking pack; T5).
- Do not silently override user effort; **surface** cumulative reasoning in telemetry so cost is visible.

## 7. Subagents (P-NEST)

- Nested loops duplicate system + tools stacks; parent also stores the report (T5 cost attribution by subagent).
- Cap depth; prefer cheap worker models when settings allow.
- Model switch mid-parent session can force a full cache rebuild — often more expensive than staying on the current model for a cheap question (T13).

## 8. Observability (P-OBS, P-HITRATE)

- Meter per-step: input, output, reasoning, cache hit/miss, layer estimates (system / history / tools).
- Meter per-run: **Σ billed input**, peak context, cache hit %, compaction count, hotspot layer (T5 `/usage` spirit).
- Alert on cache hit-rate regressions as you would on latency/uptime (T13).
