/**
 * Offline aggregator for VYOTIQ session events.jsonl / receipt.json.
 * Docs-only research harness — no product dependency.
 *
 * Usage:
 *   node parse-session.mjs <sessionDir> [outJson]
 */
import fs from 'node:fs'
import path from 'node:path'

const sessionDir = process.argv[2]
if (!sessionDir) {
  console.error('Usage: node parse-session.mjs <sessionDir> [outJson]')
  process.exit(1)
}
const outJson = process.argv[3] || path.join(sessionDir, 'benchmark-aggregate.json')

const eventsPath = path.join(sessionDir, 'events.jsonl')
const receiptPath = path.join(sessionDir, 'receipt.json')
const compactionPath = path.join(sessionDir, 'compaction.json')
const catalogPath = path.join(sessionDir, 'toolCatalog.json')

const lines = fs.readFileSync(eventsPath, 'utf8').split(/\n/).filter(Boolean)
const receipt = fs.existsSync(receiptPath)
  ? JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  : null
const compaction = fs.existsSync(compactionPath)
  ? JSON.parse(fs.readFileSync(compactionPath, 'utf8'))
  : null
const toolCatalog = fs.existsSync(catalogPath)
  ? JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  : null

const typeCount = {}
const stepUsage = []
const contextUsage = []
const mcpOmit = []
const hints = []
const compactionEvents = []
const toolResults = []
const toolStarts = []

for (const line of lines) {
  let row
  try {
    row = JSON.parse(line)
  } catch {
    continue
  }
  const ev = row.event || row
  const t = ev.type || 'unknown'
  typeCount[t] = (typeCount[t] || 0) + 1
  if (t === 'step_usage') stepUsage.push(ev)
  else if (t === 'context_usage') contextUsage.push(ev)
  else if (t === 'mcp_tools_omitted') mcpOmit.push(ev)
  else if (t === 'token_cost_hint') hints.push(ev)
  else if (t === 'compaction') compactionEvents.push(ev)
  else if (t === 'tool_result') toolResults.push(ev)
  else if (t === 'tool_start') toolStarts.push(ev)
}

function sum(arr, key) {
  return arr.reduce((a, x) => a + (Number(x[key]) || 0), 0)
}

function layersOf(ev) {
  const L = ev.layers || {}
  return {
    system: Number(L.system ?? ev.systemTokens) || 0,
    history: Number(L.history ?? ev.historyTokens) || 0,
    tools: Number(L.tools ?? ev.toolsTokens) || 0,
    buffer: Number(L.buffer ?? ev.bufferTokens) || 0
  }
}

function hotspotFromLayers(L) {
  const s = L.system
  const h = L.history
  const t = L.tools
  if (h === 0 && t === 0 && s === 0) return null
  if (h >= s && h >= t) return 'history'
  if (t >= s && t >= h) return 'tools'
  return 'system'
}

const inputs = stepUsage.map((x) => Number(x.inputTokens) || 0).filter((n) => n > 0)
const billedInput = sum(stepUsage, 'inputTokens')
const billedCached = sum(stepUsage, 'cachedInputTokens')
const billedOutput = sum(stepUsage, 'outputTokens')
const billedReasoning = sum(stepUsage, 'reasoningTokens')
const peak = inputs.length ? Math.max(...inputs) : 0
const min = inputs.length ? Math.min(...inputs) : 0
const avg = inputs.length ? billedInput / stepUsage.length : 0

// Prefer step_usage.layers + hotspot (provider-aligned). Fall back to context_usage.layers.
const hotspotHist = { history: 0, tools: 0, system: 0, other: 0 }
const layerSeries = []
function pushLayerRow(ev, inputOverride) {
  const L = layersOf(ev)
  const hs = ev.hotspot || hotspotFromLayers(L)
  if (!hs && L.system === 0 && L.history === 0 && L.tools === 0) return
  const key = hs && hotspotHist[hs] != null ? hs : 'other'
  hotspotHist[key]++
  layerSeries.push({
    step: ev.step,
    inputTokens: inputOverride ?? ev.inputTokens,
    systemTokens: L.system,
    historyTokens: L.history,
    toolsTokens: L.tools,
    bufferTokens: L.buffer,
    hotspot: hs || 'unknown',
    toolDefCount: ev.toolDefCount,
    source: ev.type
  })
}
for (const ev of stepUsage) {
  if (ev.layers || ev.hotspot) pushLayerRow(ev)
}
if (layerSeries.length === 0) {
  for (const ev of contextUsage) {
    if (ev.layers) pushLayerRow(ev, ev.inputTokens)
  }
}
let toolsToHistory = null
let lastTools = null
for (const row of layerSeries) {
  if (row.hotspot === 'tools') lastTools = row
  if (row.hotspot === 'history' && lastTools && !toolsToHistory) {
    toolsToHistory = { from: lastTools, to: row }
  }
}
const layered = layerSeries

function textOf(ev) {
  const parts = [ev.error, ev.result, ev.content, ev.message, ev.text]
  return parts
    .map((p) => (typeof p === 'string' ? p : p != null ? JSON.stringify(p) : ''))
    .join('\n')
}

const failed = toolResults.filter((ev) => ev.ok === false || /error|fail/i.test(String(ev.status || '')))
const notInCatalog = []
const notInCatalogByName = {}
for (const ev of toolResults) {
  const text = textOf(ev)
  if (/not in this step'?s tool catalog|not in this step/i.test(text)) {
    const name = ev.name || ev.toolName || 'unknown'
    notInCatalog.push({ name, step: ev.step })
    notInCatalogByName[name] = (notInCatalogByName[name] || 0) + 1
  }
}

const requestMcp = toolStarts.filter((t) => (t.name || t.toolName) === 'request_mcp_tools')
const mcpList = toolStarts.filter((t) => (t.name || t.toolName) === 'mcp_list_tools')

// step-cost curve buckets
const curve = []
for (let i = 0; i < stepUsage.length; i++) {
  const ev = stepUsage[i]
  curve.push({
    i: i + 1,
    step: ev.step,
    inputTokens: ev.inputTokens || 0,
    cachedInputTokens: ev.cachedInputTokens || 0,
    reasoningTokens: ev.reasoningTokens || 0,
    outputTokens: ev.outputTokens || 0
  })
}
const curveSample = {
  first5: curve.slice(0, 5),
  mid5: curve.slice(Math.max(0, Math.floor(curve.length / 2) - 2), Math.floor(curve.length / 2) + 3),
  last5: curve.slice(-5)
}

const aggregate = {
  meta: {
    sessionDir,
    generatedAt: new Date().toISOString(),
    eventLines: lines.length,
    label: 'AppData evidence'
  },
  receipt: receipt
    ? {
        runId: receipt.runId,
        status: receipt.status,
        step: receipt.step,
        compactionCount: receipt.compactionCount,
        tokenUsage: receipt.tokenUsage,
        toolStats: {
          totalCalls: receipt.toolStats?.totalCalls,
          ok: receipt.toolStats?.ok,
          failed: receipt.toolStats?.failed,
          byName: receipt.toolStats?.byName
        },
        failureClusters: receipt.failureClusters
      }
    : null,
  compactionFile: compaction,
  toolCatalog: toolCatalog
    ? {
        names: Array.isArray(toolCatalog)
          ? toolCatalog
          : toolCatalog.names || toolCatalog.keptNames || Object.keys(toolCatalog),
        rawKeys: toolCatalog && !Array.isArray(toolCatalog) ? Object.keys(toolCatalog) : undefined
      }
    : null,
  typeCount,
  stepUsage: {
    count: stepUsage.length,
    billedInputTokens: billedInput,
    billedCachedInputTokens: billedCached,
    cacheHitPctOfBilledInput: billedInput ? (100 * billedCached) / billedInput : 0,
    peakInputTokens: peak,
    minInputTokens: min,
    avgInputTokens: avg,
    billedOutputTokens: billedOutput,
    billedReasoningTokens: billedReasoning,
    reasoningPctOfOutput: billedOutput ? (100 * billedReasoning) / billedOutput : 0
  },
  contextUsage: {
    count: contextUsage.length,
    layeredCount: layered.length,
    hotspotHist,
    toolsToHistoryTransition: toolsToHistory,
    firstLayered: layerSeries.slice(0, 6),
    midLayered: layerSeries.slice(
      Math.max(0, Math.floor(layerSeries.length / 2) - 2),
      Math.floor(layerSeries.length / 2) + 3
    ),
    lastLayered: layerSeries.slice(-5),
    maxLayeredInput: layerSeries.reduce((m, r) => Math.max(m, Number(r.inputTokens) || 0), 0),
    maxHistory: layerSeries.reduce((m, r) => Math.max(m, Number(r.historyTokens) || 0), 0),
    maxTools: layerSeries.reduce((m, r) => Math.max(m, Number(r.toolsTokens) || 0), 0),
    steadyToolsTokens: (() => {
      const vals = layerSeries.map((r) => Number(r.toolsTokens) || 0).filter((n) => n > 0)
      if (!vals.length) return null
      const sorted = [...vals].sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    })()
  },
  mcp: {
    omitEvents: mcpOmit.length,
    omitSamples: mcpOmit.slice(0, 5),
    requestMcpToolsStarts: requestMcp.length,
    mcpListToolsStarts: mcpList.length,
    notInCatalogCount: notInCatalog.length,
    notInCatalogByName,
    failedToolResults: failed.length
  },
  hints: {
    count: hints.length,
    kinds: hints.reduce((acc, h) => {
      acc[h.kind || 'unknown'] = (acc[h.kind || 'unknown'] || 0) + 1
      return acc
    }, {})
  },
  compactionEvents: compactionEvents.length,
  stepCostCurveSample: curveSample
}

fs.writeFileSync(outJson, JSON.stringify(aggregate, null, 2))
console.log(JSON.stringify({ wrote: outJson, summary: {
  billedInput,
  peak,
  cachePct: aggregate.stepUsage.cacheHitPctOfBilledInput,
  steps: stepUsage.length,
  notInCatalog: notInCatalog.length,
  compactionFile: compaction,
  compactionEvents: compactionEvents.length,
  hotspotHist,
  toolsToHistory
}}, null, 2))
