import { basename } from '@shared/utils/path'

const BADGE_OVERRIDES: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  markdown: 'md',
  python: 'py',
  yaml: 'yml',
  shell: 'sh'
}

export function fileBadge(path: string): string | null {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return null
  const extension = name.slice(dot + 1).toLowerCase()
  const shortened = BADGE_OVERRIDES[extension]
  if (shortened) return shortened
  return extension && extension.length <= 4 ? extension : null
}

export { basename }
