import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AGENT_TOOLS } from '@main/agent/schemas/tools'
import { BUILTIN_TOOL_NAMES } from '@main/agent/tools'
import { estimateTextTokens } from '@main/agent/context/estimate'
import { BUDGET_SHARES } from '@main/agent/context/types'

const SECTION_HEADERS = [
  'WHEN TO USE:',
  'WORKFLOW:',
  'AVOID:',
  'LIMITS:',
  'RESULT:',
  'EXECUTION POLICY:'
] as const

describe('toolsSchema', () => {
  it('covers every executable built-in with a short description', () => {
    const names = AGENT_TOOLS.map((t) => t.name).sort()
    expect(names).toEqual([...BUILTIN_TOOL_NAMES].sort())
    expect(names.length).toBe(41)

    for (const tool of AGENT_TOOLS) {
      expect(tool.description.trim().length, `${tool.name} empty description`).toBeGreaterThan(0)
      for (const section of SECTION_HEADERS) {
        expect(tool.description, `${tool.name} has structured section ${section}`).not.toContain(
          section
        )
      }
    }
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
    expect(harness).toContain('## Context')
    expect(harness).toContain('## Tool policy')
    expect(harness).toContain('mcp__<serverId>__<toolName>')
    expect(harness).toContain('<attachment')
    expect(harness).toMatch(/allowlist/i)
    expect(harness).not.toMatch(/\*\*read\*\* —/)
    expect(harness).not.toMatch(/\*\*terminal\*\* —/)
    expect(harness).not.toMatch(/\*\*glob\*\* —/)
  })
})
