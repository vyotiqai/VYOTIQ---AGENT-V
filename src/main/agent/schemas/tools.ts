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

const terminalArgs = z
  .object({
    command: z
      .string()
      .describe(
        'Shell command to run at workspace root. Required to start; omit when polling an existing session_id. Shell comes from Settings → Agent → Terminal shell.'
      )
      .optional(),
    session_id: z
      .string()
      .min(1)
      .describe('Poll/await an existing background terminal session')
      .optional(),
    block_until_ms: z
      .number()
      .int()
      .min(0)
      .max(TERMINAL_MAX_TIMEOUT_MS)
      .describe(
        'How long to wait before returning (default: full timeout for foreground; use 0 to start background immediately). When polling, wait up to this many ms for exit or pattern.'
      )
      .optional(),
    pattern: z
      .string()
      .describe('Optional regex matched against combined stdout+stderr; return early when matched')
      .optional(),
    timeoutMs: z
      .number()
      .int()
      .min(1)
      .max(TERMINAL_MAX_TIMEOUT_MS)
      .describe(
        `Foreground timeout in ms when block_until_ms is omitted (default 60000, max ${TERMINAL_MAX_TIMEOUT_MS})`
      )
      .optional()
  })
  .refine((v) => Boolean(v.command?.trim()) || Boolean(v.session_id?.trim()), {
    message: 'Provide command to start a shell, or session_id to poll one'
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

const webSearchArgs = z.object({
  query: z.string().min(1).describe('Search query string.'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(15)
    .describe('Max results to return (default 8, max 15)')
    .optional(),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .describe('Request timeout in ms (default 20000)')
    .optional()
})

const browserNavigateArgs = z.object({
  url: z
    .string()
    .describe('Absolute http(s) URL to open in the built-in agent browser. Private/loopback hosts are rejected.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .describe('Navigation timeout in ms (default 30000)')
    .optional()
})

const browserSnapshotArgs = z.object({
  maxChars: z
    .number()
    .int()
    .min(1000)
    .describe('Cap on returned page text (default 40000)')
    .optional()
})

const browserClickArgs = z.object({
  selector: z
    .string()
    .min(1)
    .describe('CSS selector or snapshot ref (@e12) from the latest browser_snapshot.'),
  button: z
    .enum(['left', 'right', 'middle'])
    .describe('Mouse button (default left)')
    .optional()
})

const browserTypeArgs = z.object({
  text: z.string().describe('Text to type into the focused (or selected) element.'),
  selector: z
    .string()
    .min(1)
    .describe('Optional CSS selector or snapshot ref (@e12) to focus before typing')
    .optional(),
  clear: z.boolean().describe('Select-all and delete before typing (default false)').optional(),
  pressEnter: z.boolean().describe('Press Enter after typing (default false)').optional()
})

const browserScrollArgs = z.object({
  selector: z
    .string()
    .min(1)
    .describe('Optional CSS selector or @eN ref to scroll into view')
    .optional(),
  deltaX: z.number().describe('Horizontal scroll delta in pixels').optional(),
  deltaY: z.number().describe('Vertical scroll delta in pixels').optional()
})

const browserFillArgs = z.object({
  selector: z
    .string()
    .min(1)
    .describe('CSS selector or snapshot ref (@e12) of an input, textarea, or contenteditable.'),
  value: z.string().describe('Full value to set (replaces existing content).'),
  pressEnter: z.boolean().describe('Press Enter after filling (default false)').optional()
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

const gitStatusArgs = z.object({})

const gitDiffArgs = z.object({
  path: z
    .string()
    .describe('Optional workspace-relative path to limit the diff')
    .optional(),
  staged: z
    .boolean()
    .describe('When true, show staged (index) diff instead of working tree')
    .optional()
})

const diagnosticsArgs = z.object({
  kind: z
    .enum(['typecheck', 'lint'])
    .describe('typecheck (default) or lint — uses package scripts when present')
    .optional()
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
  web_search: {
    description:
      'Search the public web (DuckDuckGo HTML). Returns titles, URLs, and snippets. Prefer web_fetch or browser_navigate to read a specific result.',
    schema: webSearchArgs
  },
  browser_navigate: {
    description:
      'Open a public http(s) URL in the built-in live browser window (JS rendered). Prefer for SPAs; use web_fetch for static text.',
    schema: browserNavigateArgs
  },
  browser_snapshot: {
    description:
      'Capture the current agent-browser page: interactive element refs (@eN), viewport, page text, and a UI screenshot. Call browser_navigate first; prefer @eN refs with browser_click / browser_type.',
    schema: browserSnapshotArgs
  },
  browser_click: {
    description:
      'Click an element in the agent browser by CSS selector or snapshot ref (@e12). Call browser_navigate first; use browser_snapshot to list refs.',
    schema: browserClickArgs
  },
  browser_type: {
    description:
      'Type text into the agent browser. Optionally focus a CSS selector or snapshot ref (@e12) first; can clear existing text and press Enter.',
    schema: browserTypeArgs
  },
  browser_scroll: {
    description:
      'Scroll the agent browser: pass a selector/@eN to scroll into view, or deltaX/deltaY to scroll the page.',
    schema: browserScrollArgs
  },
  browser_fill: {
    description:
      'Set the full value of an input/textarea/contenteditable (React-friendly). Prefer over browser_type when replacing a field. Uses @eN refs from browser_snapshot.',
    schema: browserFillArgs
  },
  subagent: {
    description:
      'Delegate a read-only investigation to a nested agent that returns one written report.',
    schema: subagentArgs
  },
  terminal: {
    description:
      'Run a shell command with cwd at the workspace root. Output is capped. Use block_until_ms: 0 to start in the background (returns session_id); poll with session_id + block_until_ms / pattern.',
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
  },
  git_status: {
    description: 'Structured git status for the workspace (branch, changed files, +/- counts).',
    schema: gitStatusArgs
  },
  git_diff: {
    description: 'Unified git diff for the workspace (optional path; optional staged).',
    schema: gitDiffArgs
  },
  diagnostics: {
    description:
      'Run project typecheck or lint and return structured diagnostics when parseable.',
    schema: diagnosticsArgs
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
