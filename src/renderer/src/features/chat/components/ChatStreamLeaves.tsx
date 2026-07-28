import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode
} from 'react'
import type { UiItem } from '@shared/transcript'
import { GitBranchStrip, GitChangePills, useGitChrome } from './GitChrome'
import type { ChatItemsStore } from '../chatStores'

/** Bumps on workspace change, run end, and (debounced) mid-run mutating tool results. */
const MUTATING_GIT_TOOLS = new Set([
  'edit',
  'multi_edit',
  'delete',
  'terminal',
  'memory_write'
])

function useGitRevision(
  workspacePath: string | null,
  running: boolean,
  items: UiItem[]
): number {
  const [revision, setRevision] = useState(0)
  const wasRunning = useRef(running)
  const mutatingDoneCount = useRef(0)

  useEffect(() => {
    if (wasRunning.current && !running) setRevision((value) => value + 1)
    if (!wasRunning.current && running) mutatingDoneCount.current = 0
    wasRunning.current = running
  }, [running])

  useEffect(() => {
    setRevision((value) => value + 1)
  }, [workspacePath])

  useEffect(() => {
    if (!running) return
    let count = 0
    for (const item of items) {
      if (item.kind !== 'tool') continue
      if (item.tool.status !== 'done' && item.tool.status !== 'fail') continue
      if (MUTATING_GIT_TOOLS.has(item.tool.name)) count++
    }
    if (count <= mutatingDoneCount.current) return
    mutatingDoneCount.current = count
    const timer = window.setTimeout(() => {
      setRevision((value) => value + 1)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [items, running])

  return revision
}

function useLiveItems(itemsStore: ChatItemsStore | undefined, items: UiItem[]): UiItem[] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => itemsStore?.subscribeItems(onStoreChange) ?? (() => {}),
    [itemsStore]
  )
  const getRevision = useCallback(
    () => itemsStore?.getItemsRevision() ?? 0,
    [itemsStore]
  )
  useSyncExternalStore(subscribe, getRevision, getRevision)
  return itemsStore ? itemsStore.getItems() : items
}

/**
 * Boolean-only items presence — Object.is-stable across pure stream deltas so
 * ChatView / Composer skip re-renders while the transcript grows.
 */
export function useHasChatItems(
  itemsStore: ChatItemsStore | undefined,
  items: UiItem[]
): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => itemsStore?.subscribeItems(onStoreChange) ?? (() => {}),
    [itemsStore]
  )
  const getSnapshot = useCallback((): boolean => {
    const list = itemsStore ? itemsStore.getItems() : items
    return list.length > 0
  }, [itemsStore, items])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useChatLiveItems(
  itemsStore: ChatItemsStore | undefined,
  items: UiItem[]
): UiItem[] {
  return useLiveItems(itemsStore, items)
}

function useSharedGitChrome(
  itemsStore: ChatItemsStore | undefined,
  items: UiItem[],
  workspacePath: string | null,
  running: boolean,
  enabled: boolean
) {
  const liveItems = useLiveItems(itemsStore, items)
  const revision = useGitRevision(workspacePath, running, liveItems)
  return useGitChrome(workspacePath, revision, enabled)
}

/** Owns items subscription + one git fetch; keeps MemoComposer off the stream path. */
export function ChatGitLeading({
  itemsStore,
  items,
  workspacePath,
  running,
  enabled
}: {
  itemsStore?: ChatItemsStore
  items: UiItem[]
  workspacePath: string | null
  running: boolean
  enabled: boolean
}): ReactNode {
  const chrome = useSharedGitChrome(itemsStore, items, workspacePath, running, enabled)
  return <GitChangePills chrome={chrome} />
}

/**
 * Branch strip shares the same revision inputs as leading. A second gitStatus
 * call only runs when revision bumps (rare), not on every text_delta.
 */
export function ChatGitTrailing({
  itemsStore,
  items,
  workspacePath,
  running,
  enabled
}: {
  itemsStore?: ChatItemsStore
  items: UiItem[]
  workspacePath: string | null
  running: boolean
  enabled: boolean
}): ReactNode {
  const chrome = useSharedGitChrome(itemsStore, items, workspacePath, running, enabled)
  return <GitBranchStrip chrome={chrome} />
}
