import { app, crashReporter } from 'electron'

let started = false

/** Collect native minidumps locally; Sentry uploads when telemetry is enabled. */
export function initCrashReporter(): void {
  if (started) return
  try {
    crashReporter.start({
      productName: 'Vyotiq',
      companyName: 'Vyotiq',
      uploadToServer: false,
      compress: true,
      ignoreSystemCrashHandler: true
    })
    started = true
  } catch {
    // crashReporter must not block startup
  }
}

export function isCrashReporterStarted(): boolean {
  return started
}

export function crashReporterVersionTag(): string {
  try {
    return app.getVersion()
  } catch {
    return 'unknown'
  }
}
