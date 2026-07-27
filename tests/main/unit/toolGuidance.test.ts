import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AGENT_TOOLS } from '@main/agent/schemas/tools'
import { TOOL_GUIDANCE } from '@main/agent/schemas/toolGuidance'
import { estimateTextTokens } from '@main/agent/context/estimate'
import { BUDGET_SHARES } from '@main/agent/context/types'
import { READ_CONTENT_CAP, READ_DIR_LIST_CAP, READ_LINE_RANGE_MAX_BYTES } from '@main/agent/tools/read'
import { TERMINAL_MAX_OUTPUT } from '@main/agent/tools/terminal'
import { LIST_DIR_CAP } from '@main/agent/tools/listDir'
import { MEMORY_WRITE_CAP } from '@main/agent/tools/memory'
import { GLOB_DEFAULT_MAX_RESULTS, GLOB_SCAN_CAP } from '@main/agent/tools/glob'
import { GREP_MAX_FILE_BYTES, GREP_MAX_LINE_CHARS, GREP_SCAN_CAP } from '@main/agent/tools/grep'
import {
  SEARCH_DEFAULT_MAX_RESULTS,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_SCAN_CAP
} from '@main/agent/tools/search'
import {
  WEB_FETCH_DEFAULT_MAX_CHARS,
  WEB_FETCH_DEFAULT_TIMEOUT_MS,
  WEB_FETCH_MAX_TIMEOUT_MS
} from '@main/agent/tools/webFetch'
import { MAX_PARALLEL_SUBAGENTS } from '@main/agent/tools/classify'
import { MEMORY_LIST_INDEX_EXCERPT } from '@main/agent/context/memory'

const SECTIONS = ['WHEN TO USE:', 'WORKFLOW:', 'AVOID:', 'LIMITS:'] as const

describe('toolGuidance', () => {
  it('covers every built-in tool with structured sections', () => {
    const names = Object.keys(TOOL_GUIDANCE)
    expect(names.length).toBe(15)
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual([...names].sort())

    for (const tool of AGENT_TOOLS) {
      expect(tool.description).toBe(TOOL_GUIDANCE[tool.name as keyof typeof TOOL_GUIDANCE])
      for (const section of SECTIONS) {
        expect(tool.description, `${tool.name} missing ${section}`).toContain(section)
      }
    }
  })

  it('embeds implementation caps in LIMITS text', () => {
    expect(TOOL_GUIDANCE.read).toContain(String(READ_CONTENT_CAP))
    expect(TOOL_GUIDANCE.read).toContain(String(READ_LINE_RANGE_MAX_BYTES))
    expect(TOOL_GUIDANCE.read).toContain(String(READ_DIR_LIST_CAP))
    expect(TOOL_GUIDANCE.terminal).toContain(String(TERMINAL_MAX_OUTPUT))
    expect(TOOL_GUIDANCE.list_dir).toContain(String(LIST_DIR_CAP))
    expect(TOOL_GUIDANCE.memory_write).toContain(String(MEMORY_WRITE_CAP))
    expect(TOOL_GUIDANCE.memory_list).toContain(String(MEMORY_LIST_INDEX_EXCERPT))
    expect(TOOL_GUIDANCE.glob).toContain(String(GLOB_DEFAULT_MAX_RESULTS))
    expect(TOOL_GUIDANCE.glob).toContain(String(GLOB_SCAN_CAP))
    expect(TOOL_GUIDANCE.grep).toContain(String(GREP_SCAN_CAP))
    expect(TOOL_GUIDANCE.grep).toContain(String(GREP_MAX_FILE_BYTES / 1024))
    expect(TOOL_GUIDANCE.grep).toContain(String(GREP_MAX_LINE_CHARS))
    expect(TOOL_GUIDANCE.search).toContain(String(SEARCH_SCAN_CAP))
    expect(TOOL_GUIDANCE.search).toContain(String(SEARCH_MAX_FILE_BYTES / 1024))
    expect(TOOL_GUIDANCE.search).toContain(String(SEARCH_DEFAULT_MAX_RESULTS))
    expect(TOOL_GUIDANCE.web_fetch).toContain(String(WEB_FETCH_DEFAULT_MAX_CHARS))
    expect(TOOL_GUIDANCE.web_fetch).toContain(String(WEB_FETCH_DEFAULT_TIMEOUT_MS))
    expect(TOOL_GUIDANCE.web_fetch).toContain(String(WEB_FETCH_MAX_TIMEOUT_MS))
    expect(TOOL_GUIDANCE.subagent).toContain(String(MAX_PARALLEL_SUBAGENTS))
    expect(TOOL_GUIDANCE.subagent).toContain('full')
    expect(TOOL_GUIDANCE.subagent).not.toMatch(/truncated at/i)
  })

  it('states real behavioral caveats (not overclaims)', () => {
    expect(TOOL_GUIDANCE.read).toMatch(/offset\/limit/)
    expect(TOOL_GUIDANCE.read).toMatch(/dispatcher/i)
    expect(TOOL_GUIDANCE.web_fetch).toMatch(/HTML responses are converted/)
    expect(TOOL_GUIDANCE.web_fetch).toMatch(/pdf|octet-stream|rejected/i)
    expect(TOOL_GUIDANCE.search).toMatch(/Gitignore-aware/)
    expect(TOOL_GUIDANCE.multi_edit).toMatch(/mid-write disk failure/)
  })

  it('keeps read optional param descriptions in JSON Schema', () => {
    const read = AGENT_TOOLS.find((t) => t.name === 'read')
    expect(read).toBeDefined()
    const props = (read!.parameters as { properties: Record<string, { description?: string }> })
      .properties
    expect(props.startLine?.description).toMatch(/Prefer this over offset\/limit/)
    expect(props.endLine?.description).toBeTruthy()
  })

  it('emits memory_list with required:[] for OpenAI strict mode', () => {
    const mem = AGENT_TOOLS.find((t) => t.name === 'memory_list')
    expect(mem).toBeDefined()
    expect((mem!.parameters as { required?: string[] }).required).toEqual([])
  })

  it('emits todo_write status as a string enum', () => {
    const todo = AGENT_TOOLS.find((t) => t.name === 'todo_write')
    const status = (
      todo!.parameters as {
        properties: { todos: { items: { properties: { status: Record<string, unknown> } } } }
      }
    ).properties.todos.items.properties.status
    expect(status.type).toBe('string')
    expect(status.enum).toEqual(['pending', 'in_progress', 'completed', 'cancelled'])
    expect(status.description).toMatch(/in_progress/)
  })

  it('fits built-in tool defs under the default tools budget share', () => {
    const defaultWindow = 128_000
    const toolsBudget = Math.floor(defaultWindow * BUDGET_SHARES.tools)
    const estimate = estimateTextTokens(JSON.stringify(AGENT_TOOLS))
    expect(estimate).toBeLessThan(toolsBudget)
    // Leave headroom for MCP tools under typical budgets.
    expect(estimate).toBeLessThan(toolsBudget * 0.5)
  })
})

describe('harness tool catalog', () => {
  it('has Tool policy without a per-tool catalog', () => {
    const harnessPath = join(process.cwd(), 'resources', 'harness', 'default.md')
    const harness = readFileSync(harnessPath, 'utf8')
    expect(harness).toContain('## Tool policy')
    expect(harness).toContain('mcp__<serverId>__<toolName>')
    expect(harness).toContain('<attachment')
    expect(harness).toMatch(/allowlist/i)
    expect(harness).not.toMatch(/\*\*read\*\* —/)
    expect(harness).not.toMatch(/\*\*terminal\*\* —/)
    expect(harness).not.toMatch(/\*\*glob\*\* —/)
  })
})
