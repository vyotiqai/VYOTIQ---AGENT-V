import { app, crashReporter } from 'electron'

let started = false

/** Collect native minidumps locally; Sentry uploads when telemetry is enabled. */
export function initCrashReporter(): void {
  if (started) return
  try {
    // Prefer before app.ready. uploadToServer:false still stores Crashpad minidumps.
    // Do not set ignoreSystemCrashHandler — it can suppress useful OS/Crashpad handling.
    crashReporter.start({
      productName: 'Vyotiq',
      companyName: 'Vyotiq',
      submitURL: '',
      uploadToServer: false,
      compress: true
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
