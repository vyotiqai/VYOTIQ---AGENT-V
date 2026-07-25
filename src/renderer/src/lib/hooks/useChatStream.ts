import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import {
  createChatStreamController,
  type ChatStreamController
} from './createChatStreamController'

/**
 * Thin React wrapper around {@link createChatStreamController} for tests and single-workspace use.
 * Production UI should prefer {@link useWorkspaceManager} for parallel workspace contexts.
 */
export function useChatStream(workspacePath: string | null) {
  const controllerRef = useRef<ChatStreamController | null>(null)
  const pathRef = useRef(workspacePath)

  if (!controllerRef.current || pathRef.current !== workspacePath) {
    controllerRef.current?.dispose()
    controllerRef.current = createChatStreamController({
      workspacePath: workspacePath ?? ''
    })
    pathRef.current = workspacePath
  }

  const controller = controllerRef.current

  const subscribe = useCallback(
    (onStoreChange: () => void) => controller.subscribe(onStoreChange),
    [controller]
  )

  const getRevision = useCallback(() => controllerRef.current?.getRevision() ?? 0, [])

  useSyncExternalStore(subscribe, getRevision, getRevision)

  useEffect(() => {
    if (!window.vyotiq?.onChatEvent) return
    return window.vyotiq.onChatEvent((event) => {
      controllerRef.current?.handleEvent(event)
    })
  }, [controller])

  useEffect(() => {
    return () => controllerRef.current?.dispose()
  }, [])

  return {
    items: controller.items,
    messages: controller.messages,
    running: controller.running,
    runId: controller.runId,
    error: controller.error,
    runNotice: controller.runNotice,
    runCacheHint: controller.runCacheHint,
    contextUsage: controller.contextUsage,
    runStartedAt: controller.runStartedAt,
    runTerminalTick: controller.runTerminalTick,
    pendingRun: controller.pendingRun,
    transcriptLoading: controller.transcriptLoading,
    clearError: controller.clearError.bind(controller),
    send: controller.send.bind(controller),
    stop: controller.stop.bind(controller),
    reset: controller.reset.bind(controller),
    loadTranscript: controller.loadTranscript.bind(controller),
    hydrateTranscript: controller.hydrateTranscript.bind(controller)
  }
}
