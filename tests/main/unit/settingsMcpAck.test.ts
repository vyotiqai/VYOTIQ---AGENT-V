import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const userData = join(tmpdir(), `vyotiq-settings-ack-${process.pid}-${Date.now()}`)

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'userData' ? userData : join(tmpdir(), name)),
    getAppPath: () => join(tmpdir(), 'vyotiq-app'),
    isPackaged: false
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8')
  }
}))

describe('setSettings mcpServers ack gate', () => {
  beforeEach(() => {
    mkdirSync(userData, { recursive: true })
  })

  afterEach(async () => {
    const { clearSettingsCacheForTests } = await import('@main/settings/settings')
    clearSettingsCacheForTests()
    rmSync(userData, { recursive: true, force: true })
  })

  it('rejects adding stdio MCP without remoteInstallAcked', async () => {
    const { clearSettingsCacheForTests, setSettings, getSettings } = await import(
      '@main/settings/settings'
    )
    clearSettingsCacheForTests()
    expect(getSettings().marketplace?.remoteInstallAcked).toBe(false)
    expect(() =>
      setSettings({
        mcpServers: [
          {
            id: 'new-stdio',
            name: 'New',
            enabled: true,
            transport: 'stdio',
            command: 'npx',
            source: 'manual'
          }
        ]
      })
    ).toThrow(/Acknowledge marketplace/i)
  })

  it('allows adding stdio MCP after remoteInstallAcked', async () => {
    const {
      clearSettingsCacheForTests,
      setSettings,
      getSettings,
      setMarketplaceRemoteInstallAcked
    } = await import('@main/settings/settings')
    clearSettingsCacheForTests()
    setMarketplaceRemoteInstallAcked(true)
    const next = setSettings({
      mcpServers: [
        {
          id: 'new-stdio',
          name: 'New',
          enabled: true,
          transport: 'stdio',
          command: 'npx',
          source: 'manual'
        }
      ]
    })
    expect(next.mcpServers.some((s) => s.id === 'new-stdio')).toBe(true)
    expect(getSettings().mcpServers.some((s) => s.id === 'new-stdio')).toBe(true)
  })

  it('skipMcpAck allows marketplace sync without remoteInstallAcked', async () => {
    const { clearSettingsCacheForTests, setSettings, getSettings } = await import(
      '@main/settings/settings'
    )
    clearSettingsCacheForTests()
    expect(getSettings().marketplace?.remoteInstallAcked).toBe(false)
    const next = setSettings(
      {
        mcpServers: [
          {
            id: 'bundled-mcp',
            name: 'Bundled',
            enabled: true,
            transport: 'stdio',
            command: 'uvx',
            source: 'marketplace'
          }
        ]
      },
      { skipMcpAck: true }
    )
    expect(next.mcpServers.some((s) => s.id === 'bundled-mcp')).toBe(true)
    expect(() =>
      setSettings({
        mcpServers: [
          {
            id: 'manual-mcp',
            name: 'Manual',
            enabled: true,
            transport: 'stdio',
            command: 'npx',
            source: 'manual'
          }
        ]
      })
    ).toThrow(/Acknowledge marketplace/i)
  })

  it('restores Authorization when renderer echoes [redacted] back', async () => {
    const {
      clearSettingsCacheForTests,
      setSettings,
      getSettings,
      redactSettingsForIpc,
      REDACTED_VALUE,
      setMarketplaceRemoteInstallAcked
    } = await import('@main/settings/settings')
    const { readFileSync } = await import('fs')
    const { join: pathJoin } = await import('path')
    clearSettingsCacheForTests()
    setMarketplaceRemoteInstallAcked(true)
    setSettings({
      mcpServers: [
        {
          id: 'http-mcp',
          name: 'HTTP',
          enabled: true,
          transport: 'http',
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer secret-token' },
          source: 'manual'
        }
      ]
    })
    // Disk must not keep plaintext Authorization
    const onDisk = JSON.parse(readFileSync(pathJoin(userData, 'settings.json'), 'utf8')) as {
      mcpServers: Array<{ headers?: Record<string, string> }>
    }
    expect(onDisk.mcpServers[0]?.headers?.Authorization).toBe(REDACTED_VALUE)
    expect(JSON.stringify(onDisk)).not.toContain('secret-token')

    const redacted = redactSettingsForIpc(getSettings())
    const server = redacted.mcpServers.find((s) => s.id === 'http-mcp')
    expect(server?.headers?.Authorization).toBe(REDACTED_VALUE)

    const next = setSettings({
      mcpServers: redacted.mcpServers.map((s) =>
        s.id === 'http-mcp' ? { ...s, enabled: false } : s
      )
    })
    expect(next.mcpServers.find((s) => s.id === 'http-mcp')?.enabled).toBe(false)
    // Persisted shape stays redacted; getSettings restores from secure storage.
    expect(next.mcpServers.find((s) => s.id === 'http-mcp')?.headers?.Authorization).toBe(
      REDACTED_VALUE
    )
    expect(getSettings().mcpServers.find((s) => s.id === 'http-mcp')?.headers?.Authorization).toBe(
      'Bearer secret-token'
    )
  })
})
