import type { UiItem } from '@shared/transcript'

export type VirtualRow =
  | { kind: 'single'; id: string; item: UiItem }
  | { kind: 'tool-group'; id: string; tools: Extract<UiItem, { kind: 'tool' }>[] }

const TOOL_GROUP_HEADER = 40
const TOOL_GROUP_NESTED_ROW = 28
const TOOL_GROUP_EXPANDED_DETAIL = 160
const TOOL_ROW_SINGLE = 56
const TIMESTAMP_SLOT = 14

/** Collapse consecutive tool rows into one virtual row for long-thread virtualization. */
export function buildVirtualRows(items: UiItem[]): VirtualRow[] {
  const rows: VirtualRow[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]!
    if (item.kind !== 'tool') {
      rows.push({ kind: 'single', id: item.id, item })
      i += 1
      continue
    }

    const groupStart = i
    while (i < items.length && items[i].kind === 'tool') i += 1
    const tools = items.slice(groupStart, i) as Extract<UiItem, { kind: 'tool' }>[]
    if (tools.length === 1) {
      rows.push({ kind: 'single', id: tools[0]!.id, item: tools[0]! })
    } else {
      rows.push({ kind: 'tool-group', id: `tool-group:${tools[0]!.id}`, tools })
    }
  }
  return rows
}

export function estimateVirtualRowSize(row: VirtualRow): number {
  if (row.kind === 'tool-group') {
    return estimateToolGroupSize(row.tools)
  }
  return estimateItemSize(row.item)
}

function estimateToolGroupSize(tools: Extract<UiItem, { kind: 'tool' }>[]): number {
  const first = tools[0]
  const timestamp = first?.at ? TIMESTAMP_SLOT : 0
  const anyExpanded = tools.some((tool) => tool.toolExpanded)
  const nestedHeight = anyExpanded
    ? tools.reduce(
        (total, tool) =>
          total + TOOL_GROUP_NESTED_ROW + (tool.toolExpanded ? TOOL_GROUP_EXPANDED_DETAIL : 0),
        0
      )
    : 0
  const collapsed = TOOL_GROUP_HEADER + timestamp
  if (!anyExpanded) return collapsed
  return collapsed + nestedHeight + 8
}

function estimateItemSize(item: UiItem): number {
  if (item.kind === 'tool') {
    const expanded = item.toolExpanded ? TOOL_GROUP_EXPANDED_DETAIL : 0
    return TOOL_ROW_SINGLE + expanded + (item.at ? TIMESTAMP_SLOT : 0)
  }
  const chars = (item.content?.length ?? 0) + (item.thinking?.length ?? 0)
  const thinkingHeader = item.thinking || item.thinkingStreaming ? 36 : 0
  const thinkingBody =
    item.thinkingExpanded && item.thinking
      ? Math.min(240, Math.ceil(item.thinking.length / 4))
      : 0
  const timestamp = item.at ? TIMESTAMP_SLOT : 0
  const base = item.role === 'user' ? 72 : 96
  return base + timestamp + thinkingHeader + thinkingBody + Math.min(480, Math.ceil(chars / 3))
}
