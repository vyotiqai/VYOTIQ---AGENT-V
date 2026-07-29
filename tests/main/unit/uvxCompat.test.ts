import { describe, expect, it } from 'vitest'
import { hasUvxMcpWithConstraint, withCompatibleUvxArgs } from '@main/agent/mcp/uvxCompat'

describe('withCompatibleUvxArgs', () => {
  it('pins mcp<2 for mcp-server-fetch', () => {
    expect(withCompatibleUvxArgs('uvx', ['mcp-server-fetch'])).toEqual([
      '--with',
      'mcp<2',
      'mcp-server-fetch'
    ])
  })

  it('pins mcp<2 for mcp-server-time', () => {
    expect(withCompatibleUvxArgs('uvx', ['mcp-server-time'])).toEqual([
      '--with',
      'mcp<2',
      'mcp-server-time'
    ])
  })

  it('does not double-pin when --with mcp is already present', () => {
    expect(withCompatibleUvxArgs('uvx', ['--with', 'mcp==1.9.4', 'mcp-server-fetch'])).toEqual([
      '--with',
      'mcp==1.9.4',
      'mcp-server-fetch'
    ])
  })

  it('leaves unrelated uvx packages alone', () => {
    expect(withCompatibleUvxArgs('uvx', ['mcp-server-git', '--repository', '.'])).toEqual([
      'mcp-server-git',
      '--repository',
      '.'
    ])
  })

  it('leaves non-uvx commands alone', () => {
    expect(withCompatibleUvxArgs('npx', ['mcp-server-fetch'])).toEqual(['mcp-server-fetch'])
  })
})

describe('hasUvxMcpWithConstraint', () => {
  it('detects --with mcp constraints', () => {
    expect(hasUvxMcpWithConstraint(['--with', 'mcp<2', 'mcp-server-fetch'])).toBe(true)
    expect(hasUvxMcpWithConstraint(['mcp-server-fetch'])).toBe(false)
  })
})
