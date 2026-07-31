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
    const { clearSettingsCacheForTests, setSettings, getSettings } = await import(
      '@main/settings/settings'
    )
    clearSettingsCacheForTests()
    setSettings({
      marketplace: { registryUrl: '', remoteInstallAcked: true }
    })
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
      REDACTED_HEADER_VALUE
    } = await import('@main/settings/settings')
    clearSettingsCacheForTests()
    setSettings({
      marketplace: { registryUrl: '', remoteInstallAcked: true },
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
    const redacted = redactSettingsForIpc(getSettings())
    const server = redacted.mcpServers.find((s) => s.id === 'http-mcp')
    expect(server?.headers?.Authorization).toBe(REDACTED_HEADER_VALUE)

    const next = setSettings({
      mcpServers: redacted.mcpServers.map((s) =>
        s.id === 'http-mcp' ? { ...s, enabled: false } : s
      )
    })
    const stored = next.mcpServers.find((s) => s.id === 'http-mcp')
    expect(stored?.enabled).toBe(false)
    expect(stored?.headers?.Authorization).toBe('Bearer secret-token')
  })
})
