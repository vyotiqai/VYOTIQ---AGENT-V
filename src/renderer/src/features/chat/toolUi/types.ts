import type { UiSubagentEntry, UiToolRow } from '@shared/transcript'

export type ToolPresentation = 'prominent' | 'compact'

export type ToolCategory = 'file' | 'edit' | 'search' | 'command' | 'browse'

export type ToolBodyContext = {
  tool: UiToolRow
  expanded: boolean
  subagent?: UiSubagentEntry[]
  onLoadFullContent?: (toolCallId: string) => Promise<string | null>
  mcpServerNames?: ReadonlyMap<string, string>
  /** Nested inside a tool group — suppress redundant path chrome in bodies. */
  inGroup?: boolean
}

export type ToolBodyProps = ToolBodyContext & {
  loading: boolean
  loadFailed: boolean
}

export type ToolHeaderMeta = {
  verb: string
  target: string
  added?: number
  removed?: number
  icon?: 'terminal' | 'search' | 'check' | 'edit' | 'trash'
  filePath?: string
  exitCode?: number | null
}
