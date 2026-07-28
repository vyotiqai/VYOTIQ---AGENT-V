import { useEffect, useState } from 'react'
import type { Settings } from '@shared/ipc'
import { Button, Input } from '@renderer/lib/ui'
import type { SettingsFormState } from '../hooks/useSettingsForm'
import { SettingsRow } from '../components/SettingsRow'

/** Registry URL + remote-install acknowledgement — Browse/Installed live in Marketplace view. */
export function MarketplaceRegistrySection({
  settings,
  form
}: {
  settings: Settings
  form: SettingsFormState
}) {
  const [registryUrl, setRegistryUrl] = useState(settings.marketplace?.registryUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(
    null
  )

  useEffect(() => {
    setRegistryUrl(settings.marketplace?.registryUrl ?? '')
  }, [settings.marketplace?.registryUrl])

  const remoteAcked = settings.marketplace?.remoteInstallAcked ?? false

  return (
    <SettingsRow
      stacked
      title="Package registry"
      description="Optional remote catalog URL. Browse and install packages from the Marketplace sidebar. Unsigned packages — install only from sources you trust."
    >
      <div className="flex w-full flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="marketplace-registry-url" className="text-xs text-secondary">
            Registry URL (optional)
          </label>
          <div className="flex gap-2">
            <Input
              id="marketplace-registry-url"
              className="w-full font-mono text-xs"
              value={registryUrl}
              disabled={form.formLocked || busy}
              placeholder="https://registry.example.com"
              onChange={(e) => setRegistryUrl(e.target.value)}
              onBlur={() => {
                void form.runUpdate({
                  marketplace: {
                    registryUrl: registryUrl.trim(),
                    remoteInstallAcked: settings.marketplace?.remoteInstallAcked ?? false
                  }
                })
              }}
            />
            <Button
              variant="subtle"
              disabled={form.formLocked || busy}
              onClick={() => {
                void (async () => {
                  setBusy(true)
                  setFeedback(null)
                  try {
                    await form.runUpdate({
                      marketplace: {
                        registryUrl: registryUrl.trim(),
                        remoteInstallAcked: settings.marketplace?.remoteInstallAcked ?? false
                      }
                    })
                    const res = await window.vyotiq.marketplaceRefreshCatalog()
                    if (res.ok) {
                      setFeedback({
                        kind: 'success',
                        text: `Catalog refreshed (${res.data.packages.length} packages)`
                      })
                    } else setFeedback({ kind: 'error', text: res.error })
                  } finally {
                    setBusy(false)
                  }
                })()
              }}
            >
              Refresh
            </Button>
          </div>
        </div>

        <label className="inline-flex items-start gap-2 text-xs text-secondary">
          <input
            type="checkbox"
            className="mt-0.5 size-3.5 shrink-0 accent-fg"
            checked={remoteAcked}
            disabled={form.formLocked || busy}
            aria-label="Acknowledge remote install risk"
            onChange={(e) => {
              void form.runUpdate({
                marketplace: {
                  registryUrl: settings.marketplace?.registryUrl ?? registryUrl.trim(),
                  remoteInstallAcked: e.target.checked
                }
              })
            }}
          />
          <span>
            I understand remote marketplace packages and MCP endpoints are unsigned. Required once
            before installing non-bundled packages (or confirm when prompted).
          </span>
        </label>

        {feedback ? (
          <p
            className={`m-0 text-xs [overflow-wrap:anywhere] ${
              feedback.kind === 'error' ? 'text-danger' : 'text-secondary'
            }`}
            role={feedback.kind === 'error' ? 'alert' : 'status'}
          >
            {feedback.text}
          </p>
        ) : null}
      </div>
    </SettingsRow>
  )
}
