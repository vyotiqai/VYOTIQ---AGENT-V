import { app, BrowserWindow, nativeTheme } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { createWindow, applyTitleBarTheme, getMainWindow } from '@main/app/window'
import { applyCsp } from '@main/app/security'
import { closeAgentBrowser } from '@main/app/agentBrowser'
import { registerIpc } from './ipc/register'
import { shutdownMcpServers, syncMcpServers } from '@main/agent/mcp'
import { resolveEffectiveMcpServers, syncMarketplaceMcpIntoSettings } from '@main/marketplace'
import { ensureDefaultSemanticMcp } from '@main/marketplace/ensureDefaultSemanticMcp'
import { getSettings } from '@main/settings/settings'
import { migrateLegacySessions } from '@main/storage/migrations/migrateSessions'
import { migrateWorkspaceRuns } from './storage/migrateWorkspaceRuns'
import { cleanupAllLegacyHarnessArtifacts } from '@main/agent/harness'
import {
  getWorkspaces,
  interruptOrphanRunsForWorkspaces
} from '@main/workspace/workspaces'
import { initMainLogging } from './logging/init'
import { initCrashReporter } from './logging/crashReporter'
import { logger } from '../shared/logger'
import { IPC } from '../shared/channels'

// Keep Chromium caches under userData so concurrent/dev instances do not
// fight over the default Windows profile cache (Access denied / Gpu Cache).
try {
  const userData = app.getPath('userData')
  app.commandLine.appendSwitch('disk-cache-dir', join(userData, 'Cache'))
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
} catch {
  // getPath can fail in odd launch contexts; ignore
}

// Crashpad must start before any renderer is created; prefer before ready.
initCrashReporter()

// Windows: Chromium network/renderer cascade crashes have been observed at
// startup (Network service gone → RENDERER_CRASH). Prefer software GL until
// a Crashpad dump identifies a different root cause.
if (process.platform === 'win32') {
  app.disableHardwareAcceleration()
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getMainWindow() ?? BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // After userData path switches; before IPC / windows (Sentry + electron-log).
    initMainLogging()

    electronApp.setAppUserModelId('com.vyotiq.agent')
    applyCsp()
    try {
      const migration = migrateLegacySessions()
      if (migration.migrated > 0) {
        logger.info(`Migrated ${migration.migrated} legacy session(s)`, { scope: 'main' })
      }
      const runsMigration = migrateWorkspaceRuns()
      if (runsMigration.migrated > 0) {
        logger.info(`Migrated ${runsMigration.migrated} workspace run(s) to AppData`, {
          scope: 'main'
        })
      }
      const workspaces = getWorkspaces()
      cleanupAllLegacyHarnessArtifacts([
        ...workspaces.openPaths,
        ...workspaces.recentPaths
      ])
      const n = interruptOrphanRunsForWorkspaces(workspaces)
      if (n > 0) {
        logger.info(`Interrupted ${n} orphan run(s)`, { scope: 'main' })
      }
    } catch (err) {
      logger.warn('Failed startup workspace maintenance', { scope: 'main', err })
    }
    registerIpc()
    try {
      void ensureDefaultSemanticMcp().then(() => {
        void syncMcpServers(resolveEffectiveMcpServers()).catch((err) => {
          logger.warn('MCP sync after default semantic install failed', { scope: 'main', err })
        })
      })
      syncMarketplaceMcpIntoSettings()
    } catch (err) {
      logger.warn('Marketplace MCP settings sync failed', { scope: 'main', err })
    }
    void syncMcpServers(resolveEffectiveMcpServers()).catch((err) => {
      logger.warn('Initial MCP sync failed', { scope: 'main', err })
    })

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    createWindow()
    applyTitleBarTheme(getSettings().theme)

    const pushNativeTheme = (): void => {
      const win = getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.themeChanged, nativeTheme.shouldUseDarkColors)
      }
      applyTitleBarTheme(getSettings().theme)
    }
    nativeTheme.on('updated', pushNativeTheme)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
        applyTitleBarTheme(getSettings().theme)
      }
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    closeAgentBrowser()
    void shutdownMcpServers()
  })
}
