import { existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname } from 'path'
import { assertInsideWorkspace } from '../../../shared/workspacePath'
import { atomicWriteFile } from '@main/storage/atomicWrite'
import { applyUnifiedDiff } from './edit'

export type MultiEditEntry = {
  path: string
  contents?: string
  diff?: string
}

type Planned = {
  path: string
  resolved: string
  next: string
  action: 'wrote' | 'patched'
}

/**
 * Apply several file edits as one unit.
 *
 * Every edit is resolved and applied in memory first: a diff that fails to
 * match halfway through a batch would otherwise leave the workspace in a state
 * neither the model nor the user asked for.
 */
export function toolMultiEdit(workspaceRoot: string, edits: MultiEditEntry[]): string {
  if (!edits.length) throw new Error('multi_edit requires at least one edit')

  const planned: Planned[] = []
  const seen = new Set<string>()

  for (const [index, edit] of edits.entries()) {
    const path = String(edit.path ?? '').trim()
    if (!path) throw new Error(`multi_edit edit #${index + 1} is missing a path`)
    const resolved = assertInsideWorkspace(workspaceRoot, path)

    if (seen.has(resolved)) {
      throw new Error(
        `multi_edit lists ${path} twice; combine them into one edit so the result is unambiguous`
      )
    }
    seen.add(resolved)

    if (typeof edit.contents === 'string') {
      planned.push({ path, resolved, next: edit.contents, action: 'wrote' })
      continue
    }
    if (typeof edit.diff === 'string' && edit.diff.trim()) {
      const original = existsSync(resolved) ? readFileSync(resolved, 'utf8') : ''
      try {
        planned.push({
          path,
          resolved,
          next: applyUnifiedDiff(original, edit.diff),
          action: 'patched'
        })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        throw new Error(`multi_edit aborted, no files changed — ${path}: ${detail}`)
      }
      continue
    }
    throw new Error(`multi_edit edit #${index + 1} (${path}) requires contents or diff`)
  }

  for (const entry of planned) {
    mkdirSync(dirname(entry.resolved), { recursive: true })
    atomicWriteFile(entry.resolved, entry.next)
  }

  return [
    `Applied ${planned.length} edit${planned.length === 1 ? '' : 's'}:`,
    ...planned.map((entry) => `- ${entry.action} ${entry.path}`)
  ].join('\n')
}
