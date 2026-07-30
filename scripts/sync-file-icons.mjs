/**
 * Copy Material Icon Theme SVGs into the renderer public folder so Vite
 * serves/bundles them without relying on import.meta.glob into node_modules.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkgRoot = dirname(require.resolve('material-icon-theme/package.json'))
const src = join(pkgRoot, 'icons')
const dest = join(root, 'src', 'renderer', 'public', 'file-icons')

if (!existsSync(src)) {
  console.error('[sync:file-icons] missing icons at', src)
  process.exit(1)
}

rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
cpSync(src, dest, { recursive: true })
console.log('[sync:file-icons] copied icons →', dest)
