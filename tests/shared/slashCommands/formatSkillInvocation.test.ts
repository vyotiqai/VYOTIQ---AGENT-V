import { describe, expect, it } from 'vitest'
import {
  formatSkillInvocation,
  formatWorkspaceCommand,
  formatMcpToolInvocation,
  findActiveSlashToken,
  parseSlashSubmit
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
