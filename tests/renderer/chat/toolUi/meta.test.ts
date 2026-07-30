import { describe, expect, it } from 'vitest'
import { isProminentTool, toolCategory, toolLabel } from '@renderer/features/chat/toolUi/meta'
import { toolHasBody } from '@renderer/features/chat/toolUi/registry'

describe('toolUi meta', () => {
  it('marks prominent tools for standalone cards', () => {
    expect(isProminentTool('terminal')).toBe(true)
    expect(isProminentTool('edit')).toBe(true)
    expect(isProminentTool('read')).toBe(false)
    expect(isProminentTool('grep')).toBe(false)
  })

  it('demotes read-only terminal commands to compact groups', () => {
    const args = JSON.stringify({ command: 'type C:\\foo\\bar.txt' })
    expect(isProminentTool('terminal', args)).toBe(false)
    expect(isProminentTool('terminal', JSON.stringify({ command: 'pnpm build' }))).toBe(true)
  })

  it('categorizes tools for group headers', () => {
    expect(toolCategory('read')).toBe('file')
    expect(toolCategory('grep')).toBe('search')
    expect(toolCategory('list_dir')).toBe('browse')
    expect(toolCategory('memory_list')).toBe('browse')
    expect(toolCategory('git_commit')).toBe('command')
    expect(toolCategory('terminal')).toBe('command')
    expect(toolCategory('mcp__srv__read_text_file')).toBe('file')
    expect(toolCategory('mcp__srv__list_allowed_directories')).toBe('browse')
    expect(toolCategory('mcp__srv__grep_search')).toBe('search')
  })

  it('labels MCP tools with readable verbs', () => {
    expect(toolLabel('mcp__github__create_issue', 'running')).toBe('Calling Create Issue')
    expect(toolLabel('mcp__github__read_text_file', 'done')).toBe('Read file')
    expect(toolLabel('mcp__github__list_allowed_directories', 'done')).toBe('Listed directories')
  })

  it('labels ask_question from TOOL_LABELS', () => {
    expect(toolLabel('ask_question', 'running')).toBe('Asking')
    expect(toolLabel('ask_question', 'done')).toBe('Asked')
  })

  it('humanizes unknown built-in tool names', () => {
    expect(toolLabel('future_unknown_tool', 'running')).toBe('Running Future Unknown Tool')
    expect(toolLabel('future_unknown_tool', 'done')).toBe('Future Unknown Tool')
  })

  it('labels unresolved streaming tool names as Preparing', () => {
    expect(toolLabel('tool', 'running')).toBe('Preparing…')
    expect(toolLabel('', 'running')).toBe('Preparing…')
  })

  it('does not claim a body for unresolved running tool rows', () => {
    expect(
      toolHasBody({
        id: 'pending_0',
        name: 'tool',
        summary: '',
        status: 'running',
        argsPreview: '{"todos":[{"id":"1"}]}'
      })
    ).toBe(false)
  })
})
