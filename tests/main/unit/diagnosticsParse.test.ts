import { describe, expect, it } from 'vitest'
import {
  filterDiagnosticsForPaths,
  parseDiagnosticLines
} from '../../../src/main/agent/tools/diagnostics'

describe('parseDiagnosticLines', () => {
  it('parses tsc-style diagnostics', () => {
    const text = [
      "src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      'src/b.ts(1,1): warning TS6133: unused.'
    ].join('\n')
    const items = parseDiagnosticLines(text)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      file: 'src/app.ts',
      line: 10,
      col: 5,
      severity: 'error'
    })
    expect(items[0]!.message).toContain("Type 'string'")
  })

  it('parses eslint unix-style paths', () => {
    const items = parseDiagnosticLines('src/x.ts:3:7: error Missing semicolon')
    expect(items[0]).toMatchObject({
      file: 'src/x.ts',
      line: 3,
      col: 7,
      severity: 'error',
      message: 'Missing semicolon'
    })
  })
})

describe('filterDiagnosticsForPaths', () => {
  it('keeps diagnostics for matching files and directory prefixes', () => {
    const items = parseDiagnosticLines(
      [
        "src/app.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.",
        'src/b.ts(1,1): warning TS6133: unused.',
        'lib/c.ts:2:1: error boom'
      ].join('\n')
    )
    expect(filterDiagnosticsForPaths(items, ['src/app.ts']).map((d) => d.file)).toEqual([
      'src/app.ts'
    ])
    expect(filterDiagnosticsForPaths(items, ['src']).map((d) => d.file)).toEqual([
      'src/app.ts',
      'src/b.ts'
    ])
  })
})
