# Run telemetry case study (AppData)

**Label:** AppData evidence (T12)  
**Primary path (local):** `%APPDATA%/vyotiq/workspaces/7bc43636-041c-5d7d-8f48-557815f13472/sessions/80bd4074-f2ca-4423-96f9-984636d7d309`  
**Measured:** 2026-08-02 · aggregate [`benchmarks/80bd4074-aggregate.json`](./benchmarks/80bd4074-aggregate.json)  
**Freeze note:** Session continued during the audit; numbers below are the **re-parse freeze** (151 `step_usage` / Σ 4.72M). An earlier mid-audit snapshot was 137 / 4.19M — peak stayed **47,049**.  
**Purpose:** Quantify architectural burn on a real multi-step agent run. Provider/model = DeepSeek `deepseek-v4-flash`, thinking **high** — **loop-shape** conclusions are provider-agnostic; cache % is host-specific.

## Settings snapshot (relevant)

From `%APPDATA%/vyotiq/settings.json` (2026-08-02), secrets omitted:

- Provider / model: `deepseek` / `deepseek-v4-flash`
- `compactionTriggerRatio`: 0.5 · `keepRecentTurns`: 12
- `thinkingEnabled`: true · `thinkingEffort`: high
- MCP: one enabled server — marketplace `code-review-graph` (`uvx code-review-graph serve`)

## Receipt vs aggregated `step_usage`

| Field | Receipt / aggregate | Meaning |
|-------|---------------------|---------|
| `tokenUsage.inputTokens` | 40,448 | Latest step window |
| `tokenUsage.billedInputTokens` | **4,721,077** | Σ per-step input (**correct cost shape**) |
| `tokenUsage.peakInputTokens` | **47,049** | Max step input |
| `tokenUsage.billedCachedInputTokens` | **3,493,632** | Σ cached (~**74.0%** of billed input) |
| `tokenUsage.outputTokens` | 169,050 | Σ outputs |
| `tokenUsage.reasoningTokens` | 130,255 | Σ reasoning (~77% of output) |
| `step` / `step_usage` rows | 155 / **151** | Provider usage steps |
| `compactionCount` | **0** | No LLM `compaction` events |
| `toolStats` | failed **46** (freeze) | Heavy MCP + terminal/read |

Receipt billed totals **match** event Σ — prior “latest-only undercount” defect is closed on this build.

## Compaction watermark vs count

| Artifact | Value | Label |
|----------|-------|-------|
| `compaction.json.summary` | `__vyotiq_context_trim_watermark__` | AppData |
| `tokenEstimate` | 59,704 | AppData |
| `foldedMessages` | 398 | AppData |
| `compaction` events in `events.jsonl` | **0** | AppData |
| Receipt `compactionCount` | **0** | AppData |

**Finding:** Soft-cap **trim hold** persisted a watermark; payback gate skipped LLM summarize. Count 0 is consistent with event semantics — not a missing write.

## Layer / hotspot curve (`step_usage.layers`)

Hotspot histogram (freeze): **tools 10** · **history 136** · other 5.

| Phase | Step | input | system | history | tools | defs | hotspot |
|-------|-----:|------:|-------:|--------:|------:|-----:|---------|
| Start | 1 | 11,137 | 2,343 | 154 | 6,659 | 45 | tools |
| Last tools-heavy | 10 | 14,919 | 2,342 | 4,120 | 7,420 | 47 | tools |
| First history-dominant | **16** | 18,851 | 2,334 | **9,902** | 7,780 | 48 | history |
| Mid (near soft pressure) | 69–73 | ~40–43k | ~2.5k | **~49–54k** | 6,659 | 45 | history |

Steady post-freeze tools estimate **~6,659** tokens / **45** defs (builtins-only sticky catalog).

## MCP omit → request → not-in-catalog

| Signal | Count |
|--------|------:|
| `mcp_tools_omitted` | 12+ (omittedCount typically 27–30) |
| `request_mcp_tools` | 21+ |
| Parser “not in this step's tool catalog” | **20** (freeze) |
| Receipt failed tools | **46** |
| Sticky `toolCatalog.json` MCP tools | **0** (45 builtins only) |

**Mechanism (Code + AppData):** Defer-unpinned MCP keeps schemas out; early pins briefly raise def count to 47–50; sticky freeze then locks builtins-only catalog; later `request_mcp_tools` does not re-admit schemas → failed MCP calls still burn full steps.

## Takeaway

**151 × ~31.3k avg ≈ 4.72M billed input**, with **~74%** cache hits and peak held at **~47k**. Dominant remaining waste: **failed MCP round-trips after sticky freeze**, plus **high thinking** (~130k reasoning) and long single-session history. Soft-cap + zones + billed telemetry are working; MCP pin/sticky interaction is the clearest product defect for a follow-on fix plan.

---

## Appendix A — Historical case study `1f175050-…` (gone from disk)

Prior pack measurement (kept for regression contrast only; **not** re-verified 2026-08-02):

| Metric | Historical value |
|--------|------------------|
| Session | `…/sessions/1f175050-d99a-434d-82a4-cf50a7028e74` |
| Σ input / steps | ~**6.18M** / 74 `step_usage` |
| Peak / avg input | ~**130k** / ~83.5k |
| Cache share | ~**2.8%** (flat ~2.5k cached/step late) |
| Compaction events | **4** |
| Soft-cap hold | **Did not** hold working set |

**Delta vs live `80bd4074`:** peak −64% (130k→47k); cache share 2.8%→74%; compaction LLM 4→0; Σ still multi-million because step count × window remains the economic shape.
