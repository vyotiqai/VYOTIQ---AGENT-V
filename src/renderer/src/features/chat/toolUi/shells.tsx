import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/ui'
import {
  TOOL_FAMILY_DELETE,
  TOOL_FAMILY_TERMINAL,
  TOOL_FAMILY_TODO
} from '@renderer/lib/utils/layout'

const FAMILY_TOOLS = new Set(['todo_write', 'delete', 'terminal'])

/** Family body chrome for compact tools. Edit/diff use bordered ToolCard instead. */
export function wrapFamilyShell(toolName: string, children: ReactNode): ReactNode {
  if (!FAMILY_TOOLS.has(toolName)) return children

  switch (toolName) {
    case 'terminal':
      return (
        <div className={cn(TOOL_FAMILY_TERMINAL)} data-tool-family="terminal">
          {children}
        </div>
      )
    case 'todo_write':
      return (
        <div className={cn(TOOL_FAMILY_TODO)} data-tool-family="todo">
          {children}
        </div>
      )
    case 'delete':
      return (
        <div className={cn(TOOL_FAMILY_DELETE)} data-tool-family="delete">
          {children}
        </div>
      )
    default:
      return children
  }
}

/** Checklist stays open so the strip is always readable. */
export function familyDefaultExpanded(name: string, status: 'running' | 'done' | 'fail'): boolean {
  if (name === 'todo_write') return true
  return status === 'running'
}
