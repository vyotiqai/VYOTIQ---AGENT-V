import { describe, expect, it } from 'vitest'
import { FallbackBody } from '@renderer/features/chat/toolUi/bodies/McpBody'
import { getToolBody, getToolEntry } from '@renderer/features/chat/toolUi/registry'
import type { UiToolRow } from '@shared/transcript'

const FORMER_FALLBACK_TOOLS = [
  'browser_navigate',
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_fill',
  'browser_tabs',
  'browser_back',
  'browser_forward',
  'browser_wait_for_selector',
  'browser_wait_for_url',
  'browser_press_key',
  'browser_select_option',
  'diagnostics',
  'mcp_list_tools',
  'mcp_list_resources',
  'mcp_read_resource',
  'mcp_list_prompts',
  'mcp_get_prompt',
  'ask_question',
  'switch_mode',
  'git_commit',
  'generate_image',
  'edit_image'
] as const

describe('tool UI registry coverage', () => {
  it('registers structured bodies for all former FallbackBody builtins', () => {
    for (const name of FORMER_FALLBACK_TOOLS) {
      expect(getToolBody(name)).not.toBe(FallbackBody)
      expect(getToolEntry(name).Body).not.toBe(FallbackBody)
    }
  })

  it('keeps unknown tools on content-only FallbackBody without args dump', () => {
    expect(getToolBody('totally_unknown_tool_xyz')).toBe(FallbackBody)
    const entry = getToolEntry('totally_unknown_tool_xyz')
    const tool: UiToolRow = {
      id: 't1',
      name: 'totally_unknown_tool_xyz',
      summary: '',
      status: 'done',
      argsPreview: JSON.stringify({ secret: true }),
      content: 'hello result'
    }
    expect(entry.hasBody(tool)).toBe(true)
    expect(
      entry.hasBody({
        ...tool,
        content: '',
        argsPreview: JSON.stringify({ only: 'args' })
      })
    ).toBe(false)
  })

  it('does not treat chip-only ask_question/switch_mode as expandable', () => {
    const ask: UiToolRow = {
      id: 'a1',
      name: 'ask_question',
      summary: '',
      status: 'done',
      content: ''
    }
    const mode: UiToolRow = {
      id: 'm1',
      name: 'switch_mode',
      summary: '',
      status: 'done',
      content: ''
    }
    expect(getToolEntry('ask_question').hasBody(ask)).toBe(false)
    expect(getToolEntry('switch_mode').hasBody(mode)).toBe(false)
  })
})
