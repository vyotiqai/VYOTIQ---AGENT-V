import { z } from 'zod'
import { TERMINAL_MAX_TIMEOUT_MS } from '../tools/terminal'
import type { ToolDefinition } from '../providers/types'
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
      'Shell command to run at workspace root. Shell comes from Settings → Agent → Terminal shell (auto prefers PowerShell on Windows when available; cmd blocks common Unix builtins). Prefer shell-native commands for the active shell.'
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

const strReplaceArgs = z.object({
  path: z.string().describe('File path inside the workspace'),
  old_string: z
    .string()
    .min(1)
    .describe('Exact text to find. Must be unique in the file unless replace_all is true.'),
  new_string: z.string().describe('Replacement text (may be empty to delete the match)'),
  replace_all: z
    .boolean()
    .describe('Replace every occurrence (default false — fails if old_string matches more than once)')
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
    description:
      'Read a file under the workspace root (text only). Directories return a shallow listing.',
    schema: readArgs
  },
  edit: {
    description:
      'Create or overwrite a workspace file with full contents, or apply a unified diff.',
    schema: editArgs
  },
  search: {
    description:
      'Quick combined filename-or-content lookup. Default: case-insensitive substring; set regex=true for case-insensitive regex. First hit per file.',
    schema: searchArgs
  },
  glob: {
    description:
      'List workspace-relative paths matching a glob (**, *, ?, {a,b}). Gitignore-aware.',
    schema: globArgs
  },
  grep: {
    description:
      'Regex search across text file contents; every matching line with optional context. Default: case-insensitive.',
    schema: grepArgs
  },
  list_dir: {
    description: 'List one directory level with sizes. Gitignore- and build-dir-aware.',
    schema: listDirArgs
  },
  multi_edit: {
    description:
      'Apply several file edits atomically: if any edit fails to validate or match, no file is written.',
    schema: multiEditArgs
  },
  str_replace: {
    description:
      'Replace exact text in a workspace file. Prefer for surgical edits; use edit for new files or unified diffs.',
    schema: strReplaceArgs
  },
  delete: {
    description: 'Delete a workspace file, or a directory when recursive=true.',
    schema: deleteArgs
  },
  todo_write: {
    description: "Record and update this run's visible task list.",
    schema: todoWriteArgs
  },
  web_fetch: {
    description:
      'Fetch a public http(s) URL as text. HTML responses are converted to markdown; other text types are returned as trimmed text.',
    schema: webFetchArgs
  },
  subagent: {
    description:
      'Delegate a read-only investigation to a nested agent that returns one written report.',
    schema: subagentArgs
  },
  terminal: {
    description: 'Run a shell command with cwd at the workspace root. Output is capped.',
    schema: terminalArgs
  },
  memory_list: {
    description:
      'List long-term memory under .vyotiq/memory/: index excerpt, note names, whether state.md exists.',
    schema: memoryListArgs
  },
  memory_read: {
    description:
      'Read a memory file: index.md, state.md, or notes/<name>.md under .vyotiq/memory/.',
    schema: memoryReadArgs
  },
  memory_write: {
    description:
      'Create or update a memory file (index.md, state.md, or notes/<name>.md).',
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
