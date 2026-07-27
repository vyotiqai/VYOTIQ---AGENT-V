/**
 * @vitest-environment jsdom
 */
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { SettingsView } from '@renderer/features/settings'
import { emptySecretStatus, type Settings } from '@shared/ipc'
import { DEFAULT_SETTINGS } from '@shared/ipc'

afterEach(() => {
  cleanup()
})

const emptySecrets = emptySecretStatus()

const baseSettings: Settings = {
  ...DEFAULT_SETTINGS,
  provider: 'openai',
  model: 'gpt-5.6'
}

beforeEach(() => {
  // @ts-expect-error test bridge
  window.vyotiq = {
    listModels: vi.fn(async () => ({
      ok: true as const,
      data: { models: [{ id: 'gpt-5.6', inputModalities: ['text'], outputModalities: ['text'], supportsTools: true, supportsVision: false }], warning: 'seed' }
    })),
    openLogsDir: vi.fn(async () => ({ ok: true as const, data: true as const })),
    getLogsPath: vi.fn(async () => ({ ok: true as const, data: '/tmp/logs' })),
    telemetryStatus: vi.fn(async () => ({
      ok: true as const,
      data: { dsnConfigured: false, telemetryEnabled: false }
    })),
    mcpStatus: vi.fn(async () => ({ ok: true as const, data: { servers: [] } })),
    mcpRefresh: vi.fn(async () => ({ ok: true as const, data: { servers: [] } }))
  }
})

describe('settings', () => {
  it('surfaces secure-storage unavailable messaging', () => {
    render(
      <SettingsView
        settings={baseSettings}
        secrets={emptySecrets}
        encryptionAvailable={false}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    expect(screen.getByText(/secure storage is unavailable/i)).toBeTruthy()
    expect(screen.getByPlaceholderText(/Secure storage unavailable/i)).toBeTruthy()
  })

  it('settings has no duplicate model pickers; Providers sets active provider', () => {
    render(
      <SettingsView
        settings={baseSettings}
        secrets={{ ...emptySecrets, openai: true }}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )

    expect(screen.queryByLabelText(/^Model$/i)).toBeNull()
    expect(screen.queryByPlaceholderText(/Custom model id/i)).toBeNull()
    expect(screen.getByRole('button', { name: /^Providers$/i })).toBeTruthy()
    expect(screen.queryByLabelText(/Max steps/i)).toBeNull()
    expect(screen.queryByLabelText(/Enable extended thinking/i)).toBeNull()
    expect(screen.getAllByText(/^Workspaces$/i).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    expect(screen.getByLabelText(/Active provider/i)).toBeTruthy()
    expect(screen.getByLabelText(/Ollama base URL/i)).toBeTruthy()
    expect(screen.getByLabelText(/API key status/i)).toBeTruthy()
    expect(screen.queryByText(/change provider in the composer/i)).toBeNull()
  })

  it('shows custom model as read-only active model', () => {
    render(
      <SettingsView
        settings={{ ...baseSettings, provider: 'ollama', model: 'my-custom-model' }}
        secrets={emptySecrets}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )
    expect(screen.getAllByText(/my-custom-model/).length).toBeGreaterThan(0)
    expect(screen.queryByPlaceholderText(/Custom model id/i)).toBeNull()
  })

  it('surfaces save key errors as alert', async () => {
    render(
      <SettingsView
        settings={baseSettings}
        secrets={emptySecrets}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({
          ok: false as const,
          error: 'secure storage failed'
        }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    fireEvent.change(screen.getByLabelText(/API key \(OpenAI\)/i), {
      target: { value: 'sk-test' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Save key/i }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/secure storage failed/)
  })

  it('saving a non-active provider key activates it and refreshes models', async () => {
    const onSaveSecret = vi.fn(async () => ({ ok: true as const }))
    const onUpdate = vi.fn(async () => ({ ok: true as const }))
    render(
      <SettingsView
        settings={baseSettings}
        secrets={emptySecrets}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onSaveSecret={onSaveSecret}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Anthropic/i }))
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic' })
      )
    )
    fireEvent.change(screen.getByLabelText(/API key \(Anthropic\)/i), {
      target: { value: 'sk-ant' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Save key/i }))
    await waitFor(() => expect(onSaveSecret).toHaveBeenCalledWith('anthropic', 'sk-ant'))
    await waitFor(() =>
      expect(window.vyotiq.listModels).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'anthropic', forceRefresh: true })
      )
    )
    expect(screen.queryByText(/Switch provider in the composer/i)).toBeNull()
  })

  it('switches active provider to OpenRouter from Providers when DeepSeek lacks a key', async () => {
    function Harness() {
      const [settings, setSettings] = useState<Settings>({
        ...baseSettings,
        provider: 'deepseek',
        model: 'deepseek-v4-flash'
      })
      return (
        <SettingsView
          settings={settings}
          secrets={{ ...emptySecrets, openrouter: true }}
          onClose={vi.fn()}
          onUpdate={async (partial) => {
            setSettings((prev) => ({ ...prev, ...partial }))
            return { ok: true as const }
          }}
          onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
          onClearSecret={vi.fn(async () => ({ ok: true as const }))}
        />
      )
    }

    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    expect(screen.getByText(/Active provider is DeepSeek/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Use OpenRouter/i }))
    await waitFor(() =>
      expect(screen.getByLabelText(/Active provider/i).textContent).toMatch(/OpenRouter/i)
    )
    fireEvent.click(screen.getByRole('button', { name: /Refresh models/i }))
    await waitFor(() =>
      expect(window.vyotiq.listModels).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openrouter', forceRefresh: true })
      )
    )
  })

  it('refreshes models after saving active provider key', async () => {
    const onSaveSecret = vi.fn(async () => ({ ok: true as const }))
    render(
      <SettingsView
        settings={baseSettings}
        secrets={emptySecrets}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={onSaveSecret}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    fireEvent.change(screen.getByLabelText(/API key \(OpenAI\)/i), {
      target: { value: 'sk-live' }
    })
    fireEvent.click(screen.getByRole('button', { name: /Save key/i }))
    await waitFor(() => expect(onSaveSecret).toHaveBeenCalledWith('openai', 'sk-live'))
    await waitFor(() =>
      expect(window.vyotiq.listModels).toHaveBeenCalledWith(
        expect.objectContaining({ provider: 'openai', forceRefresh: true })
      )
    )
  })

  it('validates ollama url', async () => {
    const onUpdate = vi.fn(async () => ({ ok: true as const }))
    render(
      <SettingsView
        settings={baseSettings}
        secrets={emptySecrets}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    const ollama = screen.getByLabelText(/Ollama base URL/i)
    fireEvent.change(ollama, { target: { value: 'not-a-url' } })
    fireEvent.blur(ollama)
    expect((await screen.findByRole('alert')).textContent).toMatch(/http\(s\) URL/)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('surfaces refresh model errors', async () => {
    // @ts-expect-error test bridge
    window.vyotiq.listModels = vi.fn(async () => ({
      ok: false as const,
      error: 'catalog unavailable'
    }))
    render(
      <SettingsView
        settings={baseSettings}
        secrets={{ ...emptySecrets, openai: true }}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Refresh models/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/catalog unavailable/)
  })

  it('surfaces seed fallback warning as alert, not as live catalog success', async () => {
    // @ts-expect-error test bridge
    window.vyotiq.listModels = vi.fn(async () => ({
      ok: true as const,
      data: {
        models: [
          {
            id: 'qwen2.5',
            inputModalities: ['text'],
            outputModalities: ['text'],
            supportsTools: true,
            supportsVision: false
          }
        ],
        warning: 'Cannot reach Ollama at http://127.0.0.1:11434 (fetch failed: ECONNREFUSED). Showing seed defaults (not live models).'
      }
    }))
    render(
      <SettingsView
        settings={{ ...baseSettings, provider: 'ollama', model: 'qwen2.5' }}
        secrets={{ ...emptySecrets, openrouter: true }}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    expect(screen.getByText(/1\/8 saved/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Refresh models/i }))
    expect(
      await screen.findByText(/seed models for Ollama.*Cannot reach Ollama/i)
    ).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/^1 models for Ollama · fetch failed$/)).toBeNull()
  })

  it('blocks cloud refresh without a saved key before calling listModels', async () => {
    render(
      <SettingsView
        settings={{ ...baseSettings, provider: 'deepseek', model: 'deepseek-v4-flash' }}
        secrets={emptySecrets}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /^Providers$/i }))
    fireEvent.click(screen.getByRole('button', { name: /Refresh models/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/DeepSeek API key not set/i)
    expect(window.vyotiq.listModels).not.toHaveBeenCalled()
  })

  it('theme menu calls onSetTheme', () => {
    const onSetTheme = vi.fn()
    render(
      <SettingsView
        settings={baseSettings}
        secrets={{ ...emptySecrets, openai: true }}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
        onSetTheme={onSetTheme}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Theme$/i }))
    const listbox = screen.getByRole('listbox')
    fireEvent.click(within(listbox).getByText('Dark'))
    expect(onSetTheme).toHaveBeenCalledWith('dark')
  })

  it('edits MCP server fields in Advanced settings', async () => {
    const serverId = 'mcp-test-id'
    const onUpdate = vi.fn(async () => ({ ok: true as const }))
    render(
      <SettingsView
        settings={{
          ...baseSettings,
          mcpServers: [
            {
              id: serverId,
              name: 'Echo server',
              command: 'node',
              args: ['echo-server.mjs'],
              enabled: true
            }
          ]
        }}
        secrets={emptySecrets}
        onClose={vi.fn()}
        onUpdate={onUpdate}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Advanced$/i }))
    await waitFor(() => expect(window.vyotiq.mcpStatus).toHaveBeenCalled())

    const nameInput = screen.getByLabelText(`MCP server name for ${serverId}`)
    fireEvent.change(nameInput, { target: { value: 'Filesystem' } })
    fireEvent.blur(nameInput)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [
            expect.objectContaining({ id: serverId, name: 'Filesystem' })
          ]
        })
      )
    )

    const commandInput = screen.getByLabelText(`MCP command for ${serverId}`)
    fireEvent.change(commandInput, { target: { value: 'npx' } })
    fireEvent.blur(commandInput)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [expect.objectContaining({ id: serverId, command: 'npx' })]
        })
      )
    )

    const argsInput = screen.getByLabelText(`MCP arguments for ${serverId}`)
    fireEvent.change(argsInput, { target: { value: '-y\n@modelcontextprotocol/server-filesystem\n.' } })
    fireEvent.blur(argsInput)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [
            expect.objectContaining({
              id: serverId,
              args: ['-y', '@modelcontextprotocol/server-filesystem', '.']
            })
          ]
        })
      )
    )

    const envInput = screen.getByLabelText(`MCP environment for ${serverId}`)
    fireEvent.change(envInput, { target: { value: 'FOO=bar\nBAZ=qux' } })
    fireEvent.blur(envInput)
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [
            expect.objectContaining({
              id: serverId,
              env: { FOO: 'bar', BAZ: 'qux' }
            })
          ]
        })
      )
    )
  })

  it('shows MCP connection status in Advanced settings', async () => {
    // @ts-expect-error test bridge
    window.vyotiq.mcpStatus = vi.fn(async () => ({
      ok: true as const,
      data: {
        servers: [
          {
            id: 'srv-1',
            name: 'Echo',
            enabled: true,
            connected: true,
            toolCount: 2
          }
        ]
      }
    }))

    render(
      <SettingsView
        settings={{
          ...baseSettings,
          mcpServers: [
            {
              id: 'srv-1',
              name: 'Echo',
              command: 'node',
              args: ['echo.mjs'],
              enabled: true
            }
          ]
        }}
        secrets={emptySecrets}
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => ({ ok: true as const }))}
        onSaveSecret={vi.fn(async () => ({ ok: true as const }))}
        onClearSecret={vi.fn(async () => ({ ok: true as const }))}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /^Advanced$/i }))
    expect(await screen.findByText(/Connected · 2 tools/i)).toBeTruthy()
  })
})
