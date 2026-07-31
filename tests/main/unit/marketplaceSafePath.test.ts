import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => join(tmpdir(), 'vyotiq-app'),
    getPath: (name: string) => {
      if (name === 'userData') return join(tmpdir(), 'vyotiq-userdata-mkt')
      return join(tmpdir(), name)
    }
  }
}))

describe('marketplace safePath', () => {
  const userData = join(tmpdir(), 'vyotiq-userdata-mkt')

  beforeEach(() => {
    mkdirSync(join(userData, 'marketplace', 'packages'), { recursive: true })
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('rejects traversal in id/version segments', async () => {
    const { resolveInsideMarketplacePackages, isSafeMarketplaceSegment } = await import(
      '@main/marketplace/safePath'
    )
    expect(isSafeMarketplaceSegment('..')).toBe(false)
    expect(isSafeMarketplaceSegment('a/b')).toBe(false)
    expect(isSafeMarketplaceSegment('good-pkg')).toBe(true)
    expect(() => resolveInsideMarketplacePackages('..', '1.0.0')).toThrow(/Invalid marketplace/)
    expect(() => resolveInsideMarketplacePackages('pkg', '..')).toThrow(/Invalid marketplace/)
  })

  it('rejects absolute and .. plugin-relative paths', async () => {
    const { resolveInsidePackageRoot } = await import('@main/marketplace/safePath')
    const root = join(userData, 'marketplace', 'packages', 'demo', '1.0.0')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'ok.md'), 'x')
    expect(resolveInsidePackageRoot(root, 'ok.md')).toBe(join(root, 'ok.md'))
    expect(() => resolveInsidePackageRoot(root, '../escape.md')).toThrow(/Unsafe/)
    expect(() => resolveInsidePackageRoot(root, '/etc/passwd')).toThrow(/Unsafe/)
  })

  it('rejects unsafe packagePath shapes', async () => {
    const { assertSafePackagePath } = await import('@main/marketplace/safePath')
    expect(assertSafePackagePath('demo/1.0.0')).toBe('demo/1.0.0')
    expect(() => assertSafePackagePath('../x')).toThrow()
    expect(() => assertSafePackagePath('only-one')).toThrow()
  })
})
