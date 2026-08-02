import { describe, expect, it } from 'vitest'
import {
  formatSkillInvocation,
  formatWorkspaceCommand,
  formatMcpToolInvocation,
  findActiveSlashToken,
  parseSlashSubmit,
  parseSkillInvocation,
  parseMcpToolInvocation,
  skillInvocationDisplayText,
  skillInvocationEditDraft,
  userMessageDisplayText,
  resolveSlashCommandForSubmit
} from '../../../src/shared/slashCommands'

describe('formatSkillInvocation', () => {
  it('wraps skill body and trailing user text', () => {
    const msg = formatSkillInvocation('code-review', 'Do a review.', 'check auth')
    expect(msg).toContain('[Skill: code-review]')
    expect(msg).toContain('<skill instructions>')
    expect(msg).toContain('Do a review.')
    expect(msg).toContain('User request:')
    expect(msg).toContain('check auth')
  })

  it('uses placeholder when trailing text is empty', () => {
    const msg = formatSkillInvocation('docs', 'Write docs.')
    expect(msg).toContain('(no additional instructions)')
  })
})

describe('parseSkillInvocation', () => {
  it('round-trips formatSkillInvocation', () => {
    const msg = formatSkillInvocation('code-review', 'Do a review.\nBe thorough.', 'check auth')
    expect(parseSkillInvocation(msg)).toEqual({
      skillName: 'code-review',
      body: 'Do a review.\nBe thorough.',
      userRequest: 'check auth'
    })
  })

  it('treats placeholder as empty user request', () => {
    const msg = formatSkillInvocation('docs', 'Write docs.')
    expect(parseSkillInvocation(msg)?.userRequest).toBe('')
  })

  it('keeps the real user request when the body documents the closer template', () => {
    const body = [
      'Document the wrapper:',
      '</skill instructions>',
      '',
      'User request:',
      'do not treat this as the request'
    ].join('\n')
    const msg = formatSkillInvocation('docs', body, 'real request')
    expect(parseSkillInvocation(msg)).toEqual({
      skillName: 'docs',
      body,
      userRequest: 'real request'
    })
  })

  it('returns null for ordinary messages', () => {
    expect(parseSkillInvocation('hello')).toBeNull()
    expect(parseSkillInvocation('/code-review check')).toBeNull()
  })
})

describe('skillInvocationDisplayText', () => {
  it('shows slash name and user request without body', () => {
    const parsed = parseSkillInvocation(
      formatSkillInvocation('code-review', 'LONG BODY', 'focus auth')
    )!
    expect(skillInvocationDisplayText(parsed)).toBe('/code-review\n\nfocus auth')
    expect(skillInvocationDisplayText(parsed)).not.toContain('LONG BODY')
  })

  it('omits empty request placeholder', () => {
    const parsed = parseSkillInvocation(formatSkillInvocation('docs', 'body'))!
    expect(skillInvocationDisplayText(parsed)).toBe('/docs')
  })
})

describe('skillInvocationEditDraft', () => {
  it('restores slash form for re-resolve', () => {
    const parsed = parseSkillInvocation(
      formatSkillInvocation('code-review', 'body', 'check auth')
    )!
    expect(skillInvocationEditDraft(parsed)).toBe('/code-review check auth')
  })
})

describe('userMessageDisplayText', () => {
  it('collapses skill injections and passes through other text', () => {
    const skill = formatSkillInvocation('docs', 'body', 'write README')
    expect(userMessageDisplayText(skill)).toBe('/docs\n\nwrite README')
    expect(userMessageDisplayText('plain')).toBe('plain')
  })

  it('collapses MCP tool invocations', () => {
    const mcp = formatMcpToolInvocation('docs', 'search', 'desc', 'find auth')
    expect(userMessageDisplayText(mcp)).toBe('/docs-search\n\nfind auth')
  })
})

describe('parseMcpToolInvocation', () => {
  it('round-trips formatMcpToolInvocation', () => {
    const msg = formatMcpToolInvocation('srv', 'tool', 'A tool', 'do it')
    expect(parseMcpToolInvocation(msg)).toEqual({
      serverId: 'srv',
      toolName: 'tool',
      userRequest: 'do it'
    })
  })

  it('treats infer placeholder as empty request', () => {
    const msg = formatMcpToolInvocation('srv', 'tool', '')
    expect(parseMcpToolInvocation(msg)?.userRequest).toBe('')
  })

  it('round-trips multi-line tool descriptions', () => {
    const msg = formatMcpToolInvocation('srv', 'search', 'Line one\nLine two', 'find auth')
    expect(parseMcpToolInvocation(msg)).toEqual({
      serverId: 'srv',
      toolName: 'search',
      userRequest: 'find auth'
    })
  })

  it('keeps the real goal when the description mentions the goal marker', () => {
    const desc = 'Mentions\nGoal / arguments hint:\nfake'
    const msg = formatMcpToolInvocation('srv', 'tool', desc, 'real goal')
    expect(parseMcpToolInvocation(msg)?.userRequest).toBe('real goal')
  })
})

describe('resolveSlashCommandForSubmit', () => {
  const commands = [
    {
      id: 'skill:code-review',
      trigger: 'code-review',
      label: 'code-review',
      description: 'Review'
    },
    {
      id: 'builtin:compact',
      trigger: 'compact',
      label: 'Compact',
      description: 'Summarize'
    }
  ]

  it('exact-matches full triggers', () => {
    expect(resolveSlashCommandForSubmit('code-review', commands)?.id).toBe('skill:code-review')
  })

  it('prefers active command when typed trigger is a prefix', () => {
    const active = commands[0]!
    expect(resolveSlashCommandForSubmit('cod', commands, active)?.id).toBe('skill:code-review')
  })

  it('uses top fuzzy prefix hit without active command', () => {
    expect(resolveSlashCommandForSubmit('cod', commands)?.id).toBe('skill:code-review')
  })

  it('returns null when typed trigger is not a prefix of any command', () => {
    expect(resolveSlashCommandForSubmit('zzzz', commands)).toBeNull()
  })
})

describe('formatWorkspaceCommand', () => {
  it('replaces {{input}} placeholders', () => {
    expect(formatWorkspaceCommand('Run {{input}} now', 'tests')).toBe('Run tests now')
  })

  it('appends trailing text when no placeholder', () => {
    expect(formatWorkspaceCommand('Do the thing', 'extra')).toBe('Do the thing\n\nextra')
  })
})

describe('formatMcpToolInvocation', () => {
  it('names the MCP tool and server', () => {
    const msg = formatMcpToolInvocation('fetch', 'fetch', 'HTTP GET', 'https://example.com')
    expect(msg).toContain('`fetch`')
    expect(msg).toContain('`fetch`')
    expect(msg).toContain('https://example.com')
  })
})

describe('findActiveSlashToken', () => {
  it('detects token at start of draft', () => {
    const token = findActiveSlashToken('/cod', 4)
    expect(token).toEqual({
      start: 0,
      end: 4,
      trigger: 'cod',
      trailingText: '',
      query: 'cod'
    })
  })

  it('closes once cursor moves past trailing space', () => {
    expect(findActiveSlashToken('/compact check', 14)).toBeNull()
  })

  it('stays active while caret is in the trigger', () => {
    const token = findActiveSlashToken('/compact', 4)
    expect(token?.trigger).toBe('compact')
    expect(token?.query).toBe('compact')
  })
})

describe('parseSlashSubmit', () => {
  it('parses trigger and trailing args', () => {
    expect(parseSlashSubmit('/code-review look at auth')).toEqual({
      trigger: 'code-review',
      trailingText: 'look at auth'
    })
  })

  it('returns null for non-slash text', () => {
    expect(parseSlashSubmit('hello')).toBeNull()
  })
})
