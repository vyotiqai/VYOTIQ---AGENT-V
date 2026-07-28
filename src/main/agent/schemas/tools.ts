import { z } from 'zod'
import { TERMINAL_MAX_TIMEOUT_MS } from '../tools/terminal'
import type { ToolDefinition } from '../providers/types'
import { TOOL_GUIDANCE } from './toolGuidance'
import { zodToJsonSchema } from './zodToJsonSchema'

const readArgs = z
  .object({
    path: z.string().describe('Relative or absolute path inside the workspace'),
    startLine: z
      .number()
      .int()
      .min(1)
      .describe('First line to return, 1-based inclusive. Prefer this over offset/limit.')
      .optional(),
    endLine: z
      .number()
      .int()
      .min(1)
      .describe('Last line to return, 1-based inclusive. Defaults to end of file.')
      .optional(),
    offset: z
      .number()
      .min(0)
      .describe('Byte offset; only for files too large to slice by line')
      .optional(),
    limit: z.number().min(1).describe('Max bytes to read from offset').optional()
  })
  .refine(
    (args) =>
      args.startLine == null || args.endLine == null || args.endLine >= args.startLine,
    { message: 'endLine must be >= startLine', path: ['endLine'] }
  )

const editArgs = z
  .object({
    path: z.string().describe('File path inside the workspace'),
    contents: z
      .string()
      .describe('Full file contents to write (prefer for new/small files)')
      .optional(),
    diff: z
      .string()
      .describe('Unified diff with @@ hunks to apply instead of full contents')
      .optional()
  })
  .refine(
    (args) =>
      typeof args.contents === 'string' ||
      (typeof args.diff === 'string' && args.diff.trim().length > 0),
    { message: 'edit requires contents or diff' }
  )

const searchArgs = z.object({
  query: z
    .string()
    .describe('Filename fragment or content substring (or regex when regex=true)'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .describe('Max hits (default 40)')
    .optional(),
  regex: z
    .boolean()
    .describe('Treat query as case-insensitive regex (default false)')
    .optional()
})

const terminalArgs = z.object({
  command: z
    .string()
    .describe(
      'Shell command to run at workspace root. On Windows this is cmd.exe — prefer dir, type, findstr, where; avoid ls/grep/head/find/cat/which unless bash is available.'
    ),
  timeoutMs: z
    .number()
    .int()
    .min(1)
    .max(TERMINAL_MAX_TIMEOUT_MS)
    .describe(`Timeout in ms (default 60000, max ${TERMINAL_MAX_TIMEOUT_MS})`)
    .optional()
})

const globArgs = z.object({
  pattern: z
    .string()
    .describe('Glob over workspace-relative paths, e.g. src/**/*.ts or **/{README,LICENSE}*'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .describe('Max paths to return (default 100)')
    .optional()
})

const grepArgs = z.object({
  pattern: z.string().describe('Regular expression matched against each line'),
  include: z
    .string()
    .describe('Glob limiting which files are searched, e.g. src/**/*.ts')
    .optional(),
  caseSensitive: z.boolean().describe('Case-sensitive match (default false)').optional(),
  contextLines: z
    .number()
    .int()
    .min(0)
    .max(5)
    .describe('Lines of context around each hit (default 0, max 5)')
    .optional(),
  maxResults: z
    .number()
    .int()
    .min(1)
    .describe('Max matching lines (default 60)')
    .optional()
})

const listDirArgs = z.object({
  path: z
    .string()
    .describe('Workspace-relative directory (default workspace root)')
    .optional()
})

const multiEditArgs = z.object({
  edits: z
    .array(
      z
        .object({
          path: z.string().describe('File path inside the workspace'),
          contents: z
            .string()
            .describe('Full file contents to write')
            .optional(),
          diff: z
            .string()
            .describe('Unified diff to apply instead of full contents')
            .optional()
        })
        .refine(
          (args) =>
            typeof args.contents === 'string' ||
            (typeof args.diff === 'string' && args.diff.trim().length > 0),
          { message: 'each edit requires contents or diff' }
        )
    )
    .min(1)
    .describe(
      'Edits applied together atomically; if any fails, none are written. Do not list the same path twice.'
    )
})

const deleteArgs = z.object({
  path: z.string().describe('File or directory inside the workspace'),
  recursive: z
    .boolean()
    .describe('Required to delete a non-empty directory')
    .optional()
})

const todoWriteArgs = z.object({
  todos: z
    .array(
      z.object({
        id: z.string().min(1).describe('Stable id so status updates can find the task again'),
        content: z.string().min(1).describe('What the task is'),
        status: z
          .enum(['pending', 'in_progress', 'completed', 'cancelled'])
          .describe(
            'Task status. Keep at most one task in_progress; update as work progresses.'
          )
      })
    )
    .describe('The full task list, or the subset to update when merge=true'),
  merge: z
    .boolean()
    .describe('Merge these entries into the existing list instead of replacing it')
    .optional()
})
  .refine((args) => args.merge === true || args.todos.length > 0, {
    message: 'todos must be non-empty unless merge=true',
    path: ['todos']
  })

const webFetchArgs = z.object({
  url: z.string().describe('Absolute http(s) URL. Private and loopback hosts are rejected.'),
  maxChars: z
    .number()
    .int()
    .min(1000)
    .describe('Cap on returned text (default 40000)')
    .optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .describe('Request timeout in ms (default 20000)')
    .optional()
})

const subagentArgs = z.object({
  task: z
    .string()
    .describe(
      'Self-contained investigation for the sub-agent, including what to report back. Nested agent is read-only.'
    ),
  context: z
    .string()
    .describe('Findings so far that save the sub-agent re-deriving them')
    .optional()
})

const memoryListArgs = z.object({})

const memoryReadArgs = z.object({
  path: z
    .string()
    .describe(
      'Relative path inside .vyotiq/memory: index.md | state.md | notes/<name>.md'
    )
})

const memoryWriteArgs = z.object({
  path: z
    .string()
    .describe(
      'Relative path inside .vyotiq/memory: index.md | state.md | notes/<name>.md'
    ),
  contents: z
    .string()
    .describe('Full markdown contents to write. Never store secrets.')
})

const TOOL_REGISTRY = {
  read: {
    description: TOOL_GUIDANCE.read,
    schema: readArgs
  },
  edit: {
    description: TOOL_GUIDANCE.edit,
    schema: editArgs
  },
  search: {
    description: TOOL_GUIDANCE.search,
    schema: searchArgs
  },
  glob: {
    description: TOOL_GUIDANCE.glob,
    schema: globArgs
  },
  grep: {
    description: TOOL_GUIDANCE.grep,
    schema: grepArgs
  },
  list_dir: {
    description: TOOL_GUIDANCE.list_dir,
    schema: listDirArgs
  },
  multi_edit: {
    description: TOOL_GUIDANCE.multi_edit,
    schema: multiEditArgs
  },
  delete: {
    description: TOOL_GUIDANCE.delete,
    schema: deleteArgs
  },
  todo_write: {
    description: TOOL_GUIDANCE.todo_write,
    schema: todoWriteArgs
  },
  web_fetch: {
    description: TOOL_GUIDANCE.web_fetch,
    schema: webFetchArgs
  },
  subagent: {
    description: TOOL_GUIDANCE.subagent,
    schema: subagentArgs
  },
  terminal: {
    description: TOOL_GUIDANCE.terminal,
    schema: terminalArgs
  },
  memory_list: {
    description: TOOL_GUIDANCE.memory_list,
    schema: memoryListArgs
  },
  memory_read: {
    description: TOOL_GUIDANCE.memory_read,
    schema: memoryReadArgs
  },
  memory_write: {
    description: TOOL_GUIDANCE.memory_write,
    schema: memoryWriteArgs
  }
} as const

export type AgentToolName = keyof typeof TOOL_REGISTRY

export function toToolDefinitions(): ToolDefinition[] {
  return Object.entries(TOOL_REGISTRY).map(([name, { description, schema }]) => ({
    name,
    description,
    parameters: zodToJsonSchema(schema)
  }))
}

export const AGENT_TOOLS = toToolDefinitions()

export function validateToolArgs(
  name: string,
  rawJson: string
): { ok: true; data: Record<string, unknown> } | { ok: false; error: string } {
  const entry = TOOL_REGISTRY[name as AgentToolName]
  if (!entry) return { ok: false, error: `Unknown tool: ${name}` }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson || '{}')
  } catch {
    return { ok: false, error: 'Failed to parse tool arguments JSON' }
  }

  const result = entry.schema.safeParse(parsed)
  if (!result.success) {
    const detail = result.error.errors
      .map((e) => (e.path.length ? `${e.path.join('.')}: ${e.message}` : e.message))
      .join('; ')
    return { ok: false, error: detail || 'Invalid tool arguments' }
  }

  return { ok: true, data: result.data as Record<string, unknown> }
}
