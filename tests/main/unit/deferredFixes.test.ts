import { describe, expect, it } from 'vitest'
import { validateAgainstJsonSchema } from '@main/agent/schemas/jsonSchemaValidate'
import {
  combineLoopHints,
  loopHintForOmittedMcpTools
} from '@main/agent/loopPolicy'
import { trimToolsToBudget } from '@main/agent/context/toolsBudget'
import type { ToolDefinition } from '@main/agent/providers/types'
import { geminiFunctionCallingMode } from '@main/agent/providers/gemini'
import {
  isCurrentInvoke,
  markRunTurnComplete,
  registerRunAbort,
  resetActiveRunsForTests
} from '@main/agent/runRegistry'

describe('validateAgainstJsonSchema', () => {
  const echoSchema = {
    type: 'object',
    properties: {
      message: { type: 'string' }
    },
    required: ['message']
  }

  it('accepts valid objects', () => {
    expect(validateAgainstJsonSchema(echoSchema, { message: 'hi' })).toEqual({ ok: true })
  })

  it('rejects missing required properties', () => {
    const result = validateAgainstJsonSchema(echoSchema, {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/message/)
  })

  it('rejects wrong primitive types', () => {
    const result = validateAgainstJsonSchema(echoSchema, { message: 123 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/string/)
  })
})

describe('omitted MCP tools hint', () => {
  it('names omitted MCP tools for the run notice', () => {
    const tools: ToolDefinition[] = [
      { name: 'read', description: 'r', parameters: {} },
      { name: 'mcp__a__one', description: 'x'.repeat(800), parameters: {} },
      { name: 'mcp__b__two', description: 'y'.repeat(800), parameters: {} }
    ]
    const trimmed = trimToolsToBudget(tools, 50)
    expect(trimmed.omittedMcp).toBeGreaterThan(0)
    expect(trimmed.omittedMcpNames.length).toBe(trimmed.omittedMcp)
    const hint = loopHintForOmittedMcpTools(trimmed.omittedMcpNames)
    expect(hint).toMatch(/omitted/)
    expect(combineLoopHints(hint, undefined)).toBe(hint)
  })
})

describe('geminiFunctionCallingMode', () => {
  it('maps loop toolChoice to Gemini modes', () => {
    expect(geminiFunctionCallingMode('auto')).toBe('AUTO')
    expect(geminiFunctionCallingMode('required')).toBe('ANY')
    expect(geminiFunctionCallingMode('none')).toBe('NONE')
    expect(geminiFunctionCallingMode(undefined)).toBe('AUTO')
  })

  it('puts functionCallingConfig on generateContent bodies', async () => {
    const { buildGeminiBody } = await import('@main/agent/providers/gemini')
    const body = buildGeminiBody({
      model: 'gemini-2.0-flash',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'read', description: 'r', parameters: { type: 'object', properties: {} } }],
      toolChoice: 'required',
      apiKey: 'x',
      signal: new AbortController().signal
    })
    expect(
      (body.toolConfig as { functionCallingConfig: { mode: string } }).functionCallingConfig.mode
    ).toBe('ANY')
  })
})

describe('isCurrentInvoke', () => {
  it('detects when a newer invoke superseded the previous one', () => {
    resetActiveRunsForTests()
    const first = registerRunAbort('run-a', '/tmp/ws')
    expect(isCurrentInvoke('run-a', first.invokeId)).toBe(true)
    markRunTurnComplete('run-a', first.invokeId)
    const second = registerRunAbort('run-a', '/tmp/ws')
    expect(second.invokeId).not.toBe(first.invokeId)
    expect(isCurrentInvoke('run-a', first.invokeId)).toBe(false)
    expect(isCurrentInvoke('run-a', second.invokeId)).toBe(true)
    resetActiveRunsForTests()
  })
})
