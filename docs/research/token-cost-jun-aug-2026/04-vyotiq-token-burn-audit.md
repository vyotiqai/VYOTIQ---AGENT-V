# VYOTIQ token-burn audit (provider-agnostic)

**Labels:** Code (T11) + AppData evidence (T12).  
**Audit date:** 2026-08-02 (Phase 2 refresh).  
**Primary live sample:** session `80bd4074-f2ca-4423-96f9-984636d7d309` — see [`05-run-telemetry-case-study.md`](./05-run-telemetry-case-study.md) and [`benchmarks/80bd4074-aggregate.json`](./benchmarks/80bd4074-aggregate.json).  
**Rule:** Causes are architectural. AppData illustrates magnitude; do not treat one provider as the unique villain. No USD invented.

## Settings snapshot (AppData, no secrets)

| Field | Value | Label |
|-------|-------|-------|
| Provider / model | `deepseek` / `deepseek-v4-flash` | AppData |
| Thinking | enabled, effort **high** | AppData |
| `compactionTriggerRatio` | 0.5 | AppData |
| `keepRecentTurns` | 12 | AppData |
| MCP | marketplace `code-review-graph` via `uvx … serve` | AppData |
| Catalog window | 1M-class (context_usage `contextWindow` / soft trigger 64k) | Code + AppData |

## Ranked root causes (current build)

### 1. Multi-step re-send — Σ step × window (critical, architectural)

**Code:** Each iteration of [`loop.ts`](../../../src/main/agent/loop.ts) calls `assembleContext` then `provider.streamChat` with full system + tools + messages. Nested path mirrors this in [`nestedAgent.ts`](../../../src/main/agent/nestedAgent.ts).

**AppData (`80bd4074`, freeze):** **151** `step_usage` rows → **Σ billed input 4,721,077**; peak **47,049**; avg ~**31.3k**/step. Receipt `tokenUsage.billedInputTokens` matches the Σ (telemetry truthfulness **closed** vs prior case study).

This is inherent to tool-use loops (P-LOOP / T5 / T8). Mitigations reduce **per-step size** and **wasted steps**, not the loop shape.

### 2. Wasted steps: MCP omit → `request_mcp_tools` → sticky freeze → not-in-catalog (critical, defect)

**Code:** [`toolsBudget.ts`](../../../src/main/agent/context/toolsBudget.ts) defers unpinned MCP by default; after first sticky lock, **new pins are frozen out** (“Sticky tool catalog frozen; new pins omitted for cache stability”). [`loop.ts`](../../../src/main/agent/loop.ts) emits `mcp_tools_omitted` and persists `toolCatalog.json`.

**AppData:**

| Signal | Count |
|--------|------:|
| `mcp_tools_omitted` events | 12+ (typically **27–30** MCP names omitted) |
| `request_mcp_tools` starts | 21+ |
| Tool results “not in this step's tool catalog” | **20** (parser, freeze) |
| Receipt `failureClusters` “not in this step's…” | **≥29** cluster hits across MCP tools |
| Receipt failed tool calls | **46** (freeze) |

Final sticky `toolCatalog.json` lists **45 builtins only** — **zero** `mcp__code-review-graph__*` names. So pins after lock never re-enter the provider catalog → model retries MCP that cannot succeed → each failure still pays a full step window (~30–45k input).

### 3. Soft-cap hold works; peak held ~47k (mitigated vs historical)

**Code:** Soft-cap hold + pressure trim in [`assemble.ts`](../../../src/main/agent/context/assemble.ts) (history budget ← trigger − system − tools; tool bodies keep last 2 / 1 under pressure via [`toolTrim.ts`](../../../src/main/agent/context/toolTrim.ts)). Soft trigger from [`contextBudget.ts`](../../../src/shared/domain/contextBudget.ts) `COMPACTION_SOFT_CAP_TOKENS = 64_000`.

**AppData:** Peak provider input **47,049** (≪ historical `1f175050` peak **~130k**). Mid-run estimate layers show history **~49–54k** while provider input stays **~40–43k** after hold — estimate can sit near trigger while billed input stays under soft cap.

### 4. Compaction watermark ≠ LLM compaction (clarified, non-bug for count)

**Code:** Trim-only path writes [`CONTEXT_TRIM_WATERMARK_SUMMARY`](../../../src/main/agent/context/types.ts) (`__vyotiq_context_trim_watermark__`). Payback gate [`compactionPayback.ts`](../../../src/main/agent/context/compactionPayback.ts) skips LLM summarize when fold too small / residual ≥ trigger. Receipt `compactionCount` counts **`compaction` events only** ([`runReceipt.ts`](../../../src/main/agent/runReceipt.ts)).

**AppData:** `compaction.json` = watermark, `tokenEstimate` **59,704**, `foldedMessages` **398**; receipt **`compactionCount: 0`**; aggregator **0** `compaction` events. **Interpretation:** hold/trim paid with **no** summarize LLM this run — aligned with P-COMPACT payback gating. Not a telemetry lie; watermark is a different artifact.

### 5. Tools-layer tax early → history hotspot later (high, expected curve)

**AppData `step_usage.layers` hotspot histogram (freeze):** tools **10**, history **136**, other **5**. First history-dominant step **16**.

| Phase | Example | system | history | tools | hotspot |
|-------|---------|-------:|--------:|------:|---------|
| Early (step 1) | input 11,137 | 2,343 | 154 | **6,659** | tools (45 defs) |
| Early (step 2–10) | ~12–15k | ~2.3k | 1–4k | **7,420** | tools (47 defs) |
| First history (step 16) | 18,851 | ~2.3k | **9,902** | 7,780 | history (48 defs) |
| Mid (step 69–73) | ~40–43k | ~2.5k | **~49–54k** | 6,659 | history |

Steady tools estimate after sticky builtins-only: **~6.7k**/step (TOOLS_SOFT_CAP 8k). Early **47** defs briefly included pinned MCP before freeze.

### 6. High thinking / reasoning (high when enabled)

**AppData (freeze):** Σ reasoning **130,255** (~**77%** of Σ output **169,050**); `token_cost_hint` (`high_thinking_on_long_run`) re-emits on long runs. User-controlled; hints surface cost (P-THINK) — no silent downgrade.

### 7. Prompt-cache effectiveness improved vs historical (mitigated)

**Code:** [`systemZones.ts`](../../../src/main/agent/providers/systemZones.ts) stable leading / volatile trailing; sticky tools fingerprint for prefix hygiene.

**AppData (freeze):** Σ cached input **3,493,632** / Σ billed **4,721,077** ≈ **74.0%** cache share (vs historical `1f175050` ~**2.8%**). Late steps often show high cached fractions of input. Residual uncached ≈ growing history + volatile tail (expected).

### 8. Long single-run task boundary (medium / behavioral)

**AppData:** One durable chat (multi-MB messages + events); receipt step **155** at freeze; goal slash MCP build. No `/clear` between phases. Claude Code practice P-CLEAR (T5).

### 9. Amplifiers (variable)

Large MCP tool results when tools *are* in catalog (e.g. review/impact); truncation continues (≤2); stream retries; skill injection; nested absent in this receipt.

## Non-causes (this sample / current code)

| Claim | Why not |
|-------|---------|
| Receipt undercounts billed input | **Closed** — `billedInputTokens` = Σ step inputs ([`runTelemetry.ts`](../../../src/shared/utils/runTelemetry.ts) + receipt rebuild) |
| Soft-cap “never holds” | **Closed for this run** — peak 47k vs historical 130k |
| LLM compaction burning unpaid summarizes | **0** compaction events; watermark only |
| Preflight / request-body logging | Local; bodies excluded from cost logs |
| Hard step caps | Out of scope (project rule) |

## Code path verification checklist

| Path | Status |
|------|--------|
| Loop re-send | Verified — assemble + stream each step |
| Soft-cap hold + skill stub | Verified in `assemble.ts` |
| Tool trim keep-last 2 / 1 | Verified `toolTrim.ts` + types |
| Compaction payback gate | Verified `compactionPayback.ts`; live skip matches 0 LLM |
| Tools budget + sticky freeze | Verified; AppData proves freeze vs pin thrash |
| System zones stable/volatile | Verified `systemZones.ts` |
| Cumulative telemetry | Verified `runTelemetry.ts` / `runReceipt.ts` |
| Nested parity | Code present; no nested rows in this receipt |

## Contrast: historical appendix only

Older case study session `1f175050-…` is **gone from disk**. Prior pack numbers (~6.18M Σ / ~2.8% cache / peak ~130k / compactionCount 4) remain in [`05`](./05-run-telemetry-case-study.md) appendix for regression contrast — not current evidence.
