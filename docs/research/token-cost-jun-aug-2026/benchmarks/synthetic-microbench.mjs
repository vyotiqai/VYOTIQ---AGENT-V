/**
 * Synthetic micro-benchmarks (no live provider API).
 * Estimates tool-layer and history-trim sizes with a chars/4 heuristic
 * aligned with VYOTIQ's estimateTextTokens spirit (docs research only).
 *
 * Usage: node synthetic-microbench.mjs [outJson]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outPath = process.argv[2] || path.join(__dirname, 'synthetic-microbench.json')

const estimateTextTokens = (text) => Math.ceil(String(text).length / 4)

const BUILTIN_NAMES = [
  'read', 'edit', 'search', 'glob', 'grep', 'list_dir', 'multi_edit', 'str_replace',
  'delete', 'todo_write', 'web_fetch', 'mcp_list_tools', 'request_mcp_tools',
  'mcp_list_resources', 'mcp_read_resource', 'mcp_list_prompts', 'mcp_get_prompt',
  'ask_question', 'switch_mode', 'terminal', 'memory_list', 'memory_read', 'memory_write',
  'Skill', 'git_status', 'git_diff', 'git_commit', 'web_search',
  'browser_navigate', 'browser_snapshot', 'browser_click', 'browser_type', 'browser_scroll',
  'browser_fill', 'browser_tabs', 'browser_back', 'browser_forward',
  'browser_wait_for_selector', 'browser_wait_for_url', 'browser_press_key',
  'browser_select_option', 'subagent', 'diagnostics', 'generate_image', 'edit_image'
]

/** Representative MCP tool names from AppData omit preview (code-review-graph). */
const MCP_NAMES = [
  'build_or_update_graph_tool', 'run_postprocess_tool', 'get_minimal_context_tool',
  'get_impact_radius_tool', 'query_graph_tool', 'get_review_context_tool',
  'semantic_search_nodes_tool', 'embed_graph_tool', 'list_graph_stats_tool',
  'get_docs_section_tool', 'find_large_functions_tool', 'detect_changes_tool',
  'get_architecture_overview_tool', 'get_hub_nodes_tool', 'get_knowledge_gaps_tool',
  'get_suggested_questions_tool', 'list_flows_tool', 'list_communities_tool',
  'generate_wiki_tool', 'get_affected_flows_tool', 'list_communities_tool_dup',
  'refactor_tool', 'get_blame_tool', 'find_dead_code_tool', 'export_graph_tool',
  'import_graph_tool', 'health_check_tool', 'wipe_graph_tool', 'sync_index_tool',
  'describe_schema_tool'
].slice(0, 30)

function fakeTool(name, { stub = false, mcp = false } = {}) {
  const fullName = mcp ? `mcp__code-review-graph__${name}` : name
  if (stub) {
    return {
      name: fullName,
      description: `Deferred stub for ${fullName}`,
      defer_loading: true
    }
  }
  return {
    name: fullName,
    description: `Full schema placeholder for ${fullName}. `.repeat(mcp ? 8 : 3).trim(),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative path or query target' },
        query: { type: 'string', description: 'Optional search / filter string' },
        limit: { type: 'integer', description: 'Max results' },
        options: {
          type: 'object',
          properties: {
            recursive: { type: 'boolean' },
            includeTests: { type: 'boolean' },
            depth: { type: 'integer' }
          }
        }
      },
      required: mcp ? ['query'] : []
    }
  }
}

function estimateTools(tools) {
  return estimateTextTokens(JSON.stringify(tools))
}

const builtinsFull = BUILTIN_NAMES.map((n) => fakeTool(n))
const mcpFull = MCP_NAMES.map((n) => fakeTool(n, { mcp: true }))
const mcpStubs = MCP_NAMES.map((n) => fakeTool(n, { mcp: true, stub: true }))

const scenarios = {
  builtinsOnly: {
    count: builtinsFull.length,
    estimateTokens: estimateTools(builtinsFull),
    note: 'Synthetic full builtin schemas (chars/4)'
  },
  builtinsPlusMcpFull: {
    count: builtinsFull.length + mcpFull.length,
    estimateTokens: estimateTools([...builtinsFull, ...mcpFull]),
    note: 'All MCP full schemas every step (anti-pattern vs defer)'
  },
  builtinsPlusMcpDeferredStubs: {
    count: builtinsFull.length + mcpStubs.length,
    estimateTokens: estimateTools([...builtinsFull, ...mcpStubs]),
    note: 'Claude Code defer_loading-style stubs (T13)'
  },
  observedAppDataSteadyTools: {
    count: 45,
    estimateTokens: 6659,
    note: 'AppData step_usage.layers.tools median/steady after sticky builtins-only'
  },
  observedAppDataPeakTools: {
    count: 50,
    estimateTokens: 8147,
    note: 'AppData max tools layer during brief MCP pin window'
  }
}

/** Synthetic history: N tool results of size S chars; trim keepLast full bodies. */
function historyCorpus(nResults, bodyChars) {
  const msgs = [{ role: 'user', content: 'Goal: explore repo' }]
  for (let i = 0; i < nResults; i++) {
    msgs.push({
      role: 'assistant',
      content: `call tool_${i}`,
      tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read', arguments: '{}' } }]
    })
    msgs.push({
      role: 'tool',
      tool_call_id: `c${i}`,
      content: ('X'.repeat(bodyChars) + `\n# result ${i}\n`)
    })
  }
  return msgs
}

function trimToolResults(messages, keepLast) {
  const toolIdx = []
  for (let i = 0; i < messages.length; i++) if (messages[i].role === 'tool') toolIdx.push(i)
  const keep = new Set(toolIdx.slice(-keepLast))
  return messages.map((m, i) => {
    if (m.role !== 'tool' || keep.has(i)) return m
    return { ...m, content: '[cleared: re-read with tools]' }
  })
}

function estimateMessages(msgs) {
  return estimateTextTokens(JSON.stringify(msgs))
}

const BODY = 12_000 // ~ large read / MCP payload chars
const N = 40
const raw = historyCorpus(N, BODY)
const trimKeep2 = trimToolResults(raw, 2)
const trimKeep1 = trimToolResults(raw, 1)

const historyScenarios = {
  raw40x12k: {
    toolResults: N,
    bodyChars: BODY,
    estimateTokens: estimateMessages(raw),
    note: 'No trim — hoarded tool bodies'
  },
  trimKeepLast2: {
    toolResults: N,
    bodyChars: BODY,
    estimateTokens: estimateMessages(trimKeep2),
    note: 'VYOTIQ default KEEP_LAST_TOOL_RESULTS=2'
  },
  trimKeepLast1: {
    toolResults: N,
    bodyChars: BODY,
    estimateTokens: estimateMessages(trimKeep1),
    note: 'Under-pressure keep 1'
  }
}

/** Counterfactual sensitivity — labeled estimates from AppData anchors. */
const app = {
  steps: 151,
  billedInput: 4_721_077,
  peak: 47_049,
  avg: 4_721_077 / 151,
  cachePct: 0.74,
  reasoning: 130_255,
  historicalPeak: 130_088,
  historicalSteps: 74,
  historicalBilled: 6_180_389,
  notInCatalogFails: 20,
  receiptFailed: 46,
  avgLate: 32_000
}

const counterfactuals = {
  sameStepsAtHistoricalPeak: {
    label: 'estimate',
    formula: 'steps × historicalPeak',
    value: Math.round(app.steps * app.historicalPeak),
    vsActual: Math.round(app.steps * app.historicalPeak - app.billedInput),
    note: 'If soft-cap hold had not held (~130k peak) at same step count'
  },
  sameStepsAtObservedPeak: {
    label: 'AppData anchor',
    formula: 'steps × peak',
    value: Math.round(app.steps * app.peak),
    note: 'Upper bound if every step were peak-sized'
  },
  removeWastedMcpRetrySteps: {
    label: 'estimate',
    formula: 'receiptFailed × avgLate',
    value: Math.round(app.receiptFailed * app.avgLate),
    note: 'Gross input attributable to failed tool rounds if each failure ≈ one late-size step (upper; overlaps successes on same step)'
  },
  notInCatalogOnly: {
    label: 'estimate',
    formula: 'notInCatalogFails × avgLate',
    value: Math.round(app.notInCatalogFails * app.avgLate),
    note: 'Parser-confirmed not-in-catalog failures × late avg input'
  },
  cacheMissAllInput: {
    label: 'estimate',
    formula: 'billedInput × (1 − 0) vs actual cached share',
    uncachedActual: Math.round(app.billedInput * (1 - app.cachePct)),
    ifZeroCacheUncached: app.billedInput,
    deltaUncachedVsActual: Math.round(app.billedInput * app.cachePct),
    note: 'Tokens that would be fully uncached if hit rate were 0% (not USD)'
  },
  reasoningOffApprox: {
    label: 'estimate',
    formula: 'drop Σ reasoning from output side only',
    reasoningTokens: app.reasoning,
    note: 'Input Σ unchanged; output/reasoning bill shrinks by ~126k if thinking off — does not shrink input re-sends'
  },
  historicalVsLive: {
    label: 'AppData contrast',
    liveBilled: app.billedInput,
    historicalBilled: app.historicalBilled,
    livePeak: app.peak,
    historicalPeak: app.historicalPeak,
    liveCachePct: app.cachePct,
    historicalCachePct: 0.028
  }
}

const report = {
  meta: {
    generatedAt: new Date().toISOString(),
    heuristic: 'chars/4 for synthetic JSON; AppData numbers labeled separately',
    noLiveApi: true
  },
  toolLayerScenarios: scenarios,
  historyTrimScenarios: historyScenarios,
  counterfactuals,
  deltas: {
    mcpFullMinusDeferred: scenarios.builtinsPlusMcpFull.estimateTokens - scenarios.builtinsPlusMcpDeferredStubs.estimateTokens,
    mcpFullMinusBuiltins: scenarios.builtinsPlusMcpFull.estimateTokens - scenarios.builtinsOnly.estimateTokens,
    rawMinusTrim2: historyScenarios.raw40x12k.estimateTokens - historyScenarios.trimKeepLast2.estimateTokens,
    rawMinusTrim1: historyScenarios.raw40x12k.estimateTokens - historyScenarios.trimKeepLast1.estimateTokens
  }
}

fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ wrote: outPath, deltas: report.deltas, tools: scenarios, history: historyScenarios }, null, 2))
