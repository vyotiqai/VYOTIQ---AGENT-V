import { describe, expect, it } from 'vitest'
import { summarizeToolArgs } from '@shared/utils/toolSummary'

describe('toolSummary', () => {
  it('never leaks raw JSON into summaries', () => {
    const summary = summarizeToolArgs(
      'terminal',
      JSON.stringify({ command: 'type C:\\\\Users\\\\foo\\\\bar.txt' })
    )
    expect(summary).not.toContain('{')
    expect(summary).toContain('bar.txt')
  })

  it('sanitizes quoted paths in summaries', () => {
    const summary = summarizeToolArgs(
      'read',
      JSON.stringify({ path: 'C:\\Users\\"youtube tools"\\app.tsx' })
    )
    expect(summary).not.toContain('"')
    expect(summary).toContain('app.tsx')
  })
})
