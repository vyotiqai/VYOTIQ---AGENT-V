import { existsSync, mkdirSync, renameSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export function atomicWriteFile(target: string, content: string): void {
  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const temp = `${target}.tmp`
  writeFileSync(temp, content, 'utf8')
  renameSync(temp, target)
}

export function atomicWriteJson(target: string, data: unknown): void {
  atomicWriteFile(target, JSON.stringify(data, null, 2))
}
