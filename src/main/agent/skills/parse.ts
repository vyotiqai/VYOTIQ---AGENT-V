import { SkillFrontmatterSchema } from '../../../shared/ipc'

export function parseSkillFrontmatter(raw: string): {
  name: string
  description: string
  version?: string
  body: string
} {
  const trimmed = raw.replace(/^\uFEFF/, '')
  if (!trimmed.startsWith('---')) {
    throw new Error('skill.md must start with YAML frontmatter (---)')
  }
  const end = trimmed.indexOf('\n---', 3)
  if (end < 0) throw new Error('skill.md frontmatter is not closed')
  const yaml = trimmed.slice(3, end).trim()
  const body = trimmed.slice(end + 4).replace(/^\r?\n/, '')
  const fields: Record<string, string> = {}
  for (const line of yaml.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim())
    if (!m) continue
    fields[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
  const parsed = SkillFrontmatterSchema.parse({
    name: fields.name,
    description: fields.description,
    version: fields.version
  })
  return { ...parsed, body }
}
