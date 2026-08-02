# Benchmark results (offline + synthetic)

**Date:** 2026-08-02 · Phase 3  
**Freeze:** Re-parsed after session continued mid-audit — **151** `step_usage` / Σ **4,721,077** (earlier snapshot in chat was 137 / 4.19M; peak unchanged **47,049**).  
**No live provider A/B runs.** Artifacts under [`benchmarks/`](./benchmarks/).

| Artifact | Role |
|----------|------|
| [`benchmarks/parse-session.mjs`](./benchmarks/parse-session.mjs) | Offline parser for `events.jsonl` / receipt / compaction / toolCatalog |
| [`benchmarks/80bd4074-aggregate.json`](./benchmarks/80bd4074-aggregate.json) | Saved run on live session `80bd4074` |
| [`benchmarks/synthetic-microbench.mjs`](./benchmarks/synthetic-microbench.mjs) | Layer / trim / counterfactual math (no API) |
| [`benchmarks/synthetic-microbench.json`](./benchmarks/synthetic-microbench.json) | Saved synthetic outputs |

Evidence labels: **AppData** = measured from session files; **Estimate** = heuristic or counterfactual; **Code** = behavior from `src/`.

---

## 1. Offline aggregation — session `80bd4074`

**Command:**

```text
node docs/research/token-cost-jun-aug-2026/benchmarks/parse-session.mjs ^
  %APPDATA%\vyotiq\workspaces\7bc43636-041c-5d7d-8f48-557815f13472\sessions\80bd4074-f2ca-4423-96f9-984636d7d309 ^
  docs/research/token-cost-jun-aug-2026/benchmarks/80bd4074-aggregate.json
```

### Headline metrics (AppData)

| Metric | Value |
|--------|------:|
| Receipt `step` / `step_usage` rows | 155 / **151** |
| Σ billed input | **4,721,077** |
| Peak input | **47,049** |
| Avg input / step | ~31,265 |
| Σ cached input | **3,493,632** (~**74.0%**) |
| Σ output | 169,050 |
| Σ reasoning | 130,255 (~77% of output) |
| Compaction LLM events | **0** |
| Watermark `foldedMessages` | 398 |
| Watermark `tokenEstimate` | 59,704 |
| `mcp_tools_omitted` | 12+ (see aggregate) |
| `request_mcp_tools` | 21+ |
| Not-in-catalog tool results (parser) | **20** |
| Receipt failed tools | **46** |

### Hotspot histogram (AppData `step_usage.hotspot`)

| Hotspot | Steps |
|---------|------:|
| tools | 10 |
| history | 136 |
| other | 5 |

**Transition:** last tools-dominant step **10** → first history-dominant step **16** (input 18,851; history 9,902; tools 7,780; 48 defs).

### Step-cost curve sample (AppData)

| Region | Step | input | cached | reasoning |
|--------|-----:|------:|-------:|----------:|
| First | 1 | 11,137 | 1,536 | 384 |
| | 5 | 13,737 | 2,176 | 134 |
| Mid | 70 | 42,791 | 10,752 | 2,853 |
| | 72 | 40,652 | 32,768 | 3,108 |
| Late (freeze) | ~155 | ~40k | ~39k | (see aggregate last5) |

---

## 2. Synthetic micro-benchmarks (no API)

**Heuristic:** `ceil(JSON.length / 4)` for synthetic corpora; AppData rows labeled separately.

### 2a. Tools layer sizes

| Scenario | Tool count | Est. tokens | Label |
|----------|-----------:|------------:|-------|
| Builtins only (synthetic full schemas) | 45 | 6,412 | Estimate |
| Builtins + 30 MCP **full** | 75 | 14,498 | Estimate |
| Builtins + 30 MCP **defer stubs** | 75 | 7,586 | Estimate (T13 pattern) |
| AppData steady (sticky builtins) | 45 | **6,659** | AppData |
| AppData peak tools (brief MCP pin) | 50 | **8,147** | AppData |

**Deltas (Estimate):** Full MCP − deferred stubs ≈ **+6,912**/step; Full MCP − builtins ≈ **+8,086**/step.

**Interpretation:** Deferral is correct. Live waste is **pin after sticky freeze → not-in-catalog retries**.

### 2b. History trim with / without

Synthetic: **40** tool results × **12,000** chars each.

| Scenario | Est. tokens | Label |
|----------|------------:|-------|
| No trim | 122,012 | Estimate |
| Keep last **2** | 8,148 | Estimate |
| Keep last **1** | 5,151 | Estimate |

**Deltas:** raw − keep2 ≈ **113,864**; raw − keep1 ≈ **116,861**.

---

## 3. Counterfactual sensitivity (labeled estimates)

Anchors from AppData freeze (151 steps / 4.72M). **Not USD. Not guarantees.**

| Counterfactual | Formula | Value | Label |
|----------------|---------|------:|-------|
| Same 151 steps at historical peak ~130k | 151 × 130,088 | **~19.6M** | Estimate |
| vs actual billed 4.72M | delta | **~+14.9M** | Estimate |
| Same steps × observed peak 47k | 151 × 47,049 | ~7.1M | Estimate (upper) |
| Not-in-catalog × late avg ~32k | 20 × 32,000 | **640,000** | Estimate |
| All receipt failures × late avg | 46 × 32,000 | **1,472,000** | Estimate (gross) |
| Cache share → 0% (uncached Δ) | 74% × 4.72M | **~3.5M** more uncached | Estimate |
| Reasoning off | drop Σ reasoning | **−130,255** output-side | Estimate — input Σ unchanged |
| Historical appendix `1f175050` | measured | 6.18M / 2.8% cache / peak 130k | Historical AppData |

**Reading:** Soft-cap hold is the largest already-realized win vs historical peak shape. Next actionable estimate: cut failed MCP steps (~0.6–1.5M gross input).

---

## 4. Excluded

- Live multi-step paid A/B agent marathons  
- Invented USD  
- Product code changes under `src/` / `tests/`
