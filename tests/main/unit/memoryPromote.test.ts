import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promoteCompactionToMemory } from '@main/agent/context/memoryPromote'
import { readMemoryFile } from '@main/agent/context/memory'

function structuredSummary(data: {
  sessionIntent: string
  filesTouched: string[]
  keyDecisions: string[]
  constraints: string[]
  openBlockers: string[]
  nextSteps: string[]
}): string {
  return JSON.stringify(data)
}

describe('promoteCompactionToMemory', () => {
  it('writes structured compaction facts into index.md and state.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vyotiq-promote-'))
    const summary = structuredSummary({
      sessionIntent: 'Add search gitignore support',
      filesTouched: ['src/main/agent/tools/search.ts'],
      keyDecisions: ['Use nested matchers per directory'],
      constraints: ['No secrets in memory'],
      openBlockers: [],
      nextSteps: ['Add tests']
    })

    promoteCompactionToMemory(dir, {
      summary,
      createdAt: new Date().toISOString(),
      tokenEstimate: 50
    })

    const index = readMemoryFile(dir, 'index.md')
    expect(index).toMatch(/search gitignore support/i)
    expect(index).toMatch(/search\.ts/)

    const state = readMemoryFile(dir, 'state.md')
    expect(state).toMatch(/nested matchers/i)
    expect(state).toMatch(/No secrets in memory/)
  })

  it('dedupes repeated promotions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vyotiq-promote-dedupe-'))
    const record = {
      summary: structuredSummary({
        sessionIntent: 'Same fact',
        filesTouched: [],
        keyDecisions: ['Reuse matcher cache'],
        constraints: [],
        openBlockers: [],
        nextSteps: []
      }),
      createdAt: new Date().toISOString(),
      tokenEstimate: 10
    }

    promoteCompactionToMemory(dir, record)
    promoteCompactionToMemory(dir, record)

    const state = readMemoryFile(dir, 'state.md')
    expect(state.match(/Reuse matcher cache/g)?.length).toBe(1)
  })

  it('promotes freeform markdown sections into memory files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vyotiq-promote-freeform-'))
    promoteCompactionToMemory(dir, {
      summary: [
        '## Session Intent',
        'Fix search gitignore',
        '',
        '## Key Decisions',
        '- Use nested matchers',
        '',
        '## Next Steps',
        '- Add tests'
      ].join('\n'),
      createdAt: '2026-01-15T00:00:00.000Z',
      tokenEstimate: 5
    })

    const index = readMemoryFile(dir, 'index.md')
    expect(index).toMatch(/search gitignore/i)
    const state = readMemoryFile(dir, 'state.md')
    expect(state).toMatch(/nested matchers/i)
  })

  it('writes unstructured freeform summaries to notes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vyotiq-promote-freeform-'))
    promoteCompactionToMemory(dir, {
      summary: 'Just a plain paragraph with no JSON.',
      createdAt: '2026-01-15T00:00:00.000Z',
      tokenEstimate: 5
    })

    const index = readMemoryFile(dir, 'index.md')
    expect(index).not.toMatch(/plain paragraph/)
    const note = readMemoryFile(dir, 'notes/compaction-2026-01-15.md')
    expect(note).toMatch(/plain paragraph/)
  })
})
