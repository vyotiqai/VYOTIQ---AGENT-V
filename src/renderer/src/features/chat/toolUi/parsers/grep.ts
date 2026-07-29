import type { UiToolRow } from '@shared/transcript'
import { parseArgsRecord } from '@shared/toolSummary'

export type GrepMatch = {
  line: number
  text: string
  isMatch: boolean
}

export type GrepFileGroup = {
  file: string
  matches: GrepMatch[]
}

export type GrepParsed = {
  pattern: string
  matchCount: number
  truncated: boolean
  groups: GrepFileGroup[]
}

export function parseGrepData(tool: UiToolRow): GrepParsed {
  const args = parseArgsRecord(tool.argsPreview)
  const pattern =
    typeof args?.pattern === 'string' ? args.pattern : tool.summary?.trim() || ''
  const content = tool.content ?? ''
  const truncated = content.includes('stopped at') && content.includes('matches')

  if (content.startsWith('No matches for')) {
    return { pattern, matchCount: 0, truncated: false, groups: [] }
  }

  const groups: GrepFileGroup[] = []
  let current: GrepFileGroup | null = null
  let matchCount = 0

  for (const raw of content.split('\n')) {
    const line = raw.trimEnd()
    if (!line || line.startsWith('…')) continue

    const simple = line.match(/^(.+?):(\d+):\s*(.*)$/)
    if (simple) {
      matchCount += 1
      const [, file, lineNum, text] = simple
      groups.push({ file: file!, matches: [{ line: Number(lineNum), text: text!, isMatch: true }] })
      current = null
      continue
    }

    const header = line.match(/^(.+?):(\d+)$/)
    if (header) {
      current = { file: header[1]!, matches: [] }
      groups.push(current)
      continue
    }

    const ctx = line.match(/^([> ])\s*(\d+)\|\s*(.*)$/)
    if (ctx && current) {
      const [, marker, lineNum, text] = ctx
      current.matches.push({ line: Number(lineNum), text: text!, isMatch: marker === '>' })
      if (marker === '>') matchCount += 1
    }
  }

  return { pattern, matchCount, truncated, groups }
}
