import { z } from 'zod'
import type { ToolDefinition } from '../providers/types'
import { zodToJsonSchema } from './zodToJsonSchema'

const readArgs = z.object({
  path: z.string().describe('Relative or absolute path inside the workspace'),
  startLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('First line to return, 1-based inclusive. Prefer this over offset/limit.'),
  endLine: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe('Last line to return, 1-based inclusive. Defaults to end of file.'),
  offset: z
    .number()
    .optional()
    .describe('Byte offset; only for files too large to slice by line'),
  limit: z.number().optional().describe('Max bytes to read from offset')
})

const editArgs = z
  .object({
    path: z.string().describe('File path inside the workspace'),
    contents: z.string().optional().describe('Full file contents to write'),
    diff: z.string().optional().describe('Unified diff to apply instead of full contents')
  })
  .refine(
    (args) =>
      typeof args.contents === 'string' ||
      (typeof args.diff === 'string' && args.diff.trim().length > 0),
    { message: 'edit requires contents or diff' }
  )

const searchArgs = z.object({
  query: z.string().describe('Filename fragment or content substring (or regex when regex=true)'),
  maxResults: z.number().optional().describe('Max hits (default 40)'),
  regex: z.boolean().optional().describe('Treat query as case-insensitive regex (default false)')
})

const terminalArgs = z.object({
  command: z.string().describe('Shell command to run'),
  timeoutMs: z.number().optional().describe('Timeout in ms (default 60000)')
})

const globArgs = z.object({
  pattern: z
    .string()
    .describe('Glob over workspace-relative paths, e.g. src/**/*.ts or **/{README,LICENSE}*'),
  maxResults: z.number().int().min(1).optional().describe('Max paths to return (default 100)')
})

const grepArgs = z.object({
  pattern: z.string().describe('Regular expression matched against each line'),
  include: z.string().optional().describe('Glob limiting which files are searched'),
  caseSensitive: z.boolean().optional().describe('Default false'),
  contextLines: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe('Lines of context around each hit (default 0)'),
  maxResults: z.number().int().min(1).optional().describe('Max matching lines (default 60)')
})

const listDirArgs = z.object({
  path: z.string().optional().describe('Workspace-relative directory (default workspace root)')
})

const multiEditArgs = z.object({
  edits: z
    .array(
      z
        .object({
          path: z.string().describe('File path inside the workspace'),
          contents: z.string().optional().describe('Full file contents to write'),
          diff: z.string().optional().describe('Unified diff to apply instead of full contents')
        })
        .refine(
          (args) =>
            typeof args.contents === 'string' ||
            (typeof args.diff === 'string' && args.diff.trim().length > 0),
          { message: 'each edit requires contents or diff' }
        )
    )
    .min(1)
    .describe('Edits applied together; if any fails, none are written')
})

const deleteArgs = z.object({
  path: z.string().describe('File or directory inside the workspace'),
  recursive: z.boolean().optional().describe('Required to delete a non-empty directory')
})

const todoWriteArgs = z.object({
  todos: z
    .array(
      z.object({
        id: z.string().describe('Stable id so status updates can find the task again'),
        content: z.string().describe('What the task is'),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled'])
      })
    )
    .describe('The full task list, or the subset to update when merge=true'),
  merge: z
    .boolean()
    .optional()
    .describe('Merge these entries into the existing list instead of replacing it')
})

const webFetchArgs = z.object({
  url: z.string().describe('Absolute http(s) URL. Private and loopback hosts are rejected.'),
  maxChars: z.number().int().min(1000).optional().describe('Cap on returned text (default 40000)'),
  timeoutMs: z.number().int().min(1000).optional().describe('Request timeout (default 20000)')
})

const subagentArgs = z.object({
  task: z
    .string()
    .describe('Self-contained investigation for the sub-agent, including what to report back'),
  context: z.string().optional().describe('Findings so far that save the sub-agent re-deriving them'),
  maxSteps: z.number().int().min(1).max(16).optional().describe('Step budget (default 8)')
})

const memoryListArgs = z.object({})

const memoryReadArgs = z.object({
  path: z
    .string()
    .describe('Relative path inside .vyotiq/memory (index.md | state.md | notes/…)')
})

const memoryWriteArgs = z.object({
  path: z.string().describe('Relative path inside .vyotiq/memory'),
  contents: z.string().describe('Full markdown contents to write')
})

const TOOL_REGISTRY = {
  read: {
    description:
      'Read a file under the workspace root. Returns text contents (size capped). For large files use offset/limit. Directories return a listing.',
    schema: readArgs
  },
  edit: {
    description:
      'Create/overwrite a file with full contents, or apply a unified diff. Prefer contents for new/small files.',
    schema: editArgs
  },
  search: {
    description:
      'Search filenames and text file contents. Default: case-insensitive substring. Set regex=true for regex. Ignores node_modules, .git, and build dirs.',
    schema: searchArgs
  },
  glob: {
    description:
      'List workspace files whose path matches a glob (**, *, ?, {a,b}). Gitignore-aware. Use this to find files by name or extension instead of shelling out.',
    schema: globArgs
  },
  grep: {
    description:
      'Regex search across text file contents, reporting every matching line with optional context. Use search for a quick filename-or-content lookup; use grep when you need all the hits.',
    schema: grepArgs
  },
  list_dir: {
    description:
      'List one directory level with file sizes, skipping gitignored and build directories.',
    schema: listDirArgs
  },
  multi_edit: {
    description:
      'Apply several file edits atomically: if any edit fails to apply, no file is written. Prefer this over repeated edit calls for a coordinated change.',
    schema: multiEditArgs
  },
  delete: {
    description:
      'Delete a file, or a directory when recursive=true. Scoped to the workspace root.',
    schema: deleteArgs
  },
  todo_write: {
    description:
      'Record the task list for this run so progress is visible. Keep at most one task in_progress, and update status as work completes.',
    schema: todoWriteArgs
  },
  web_fetch: {
    description:
      'Fetch a public http(s) URL and return it as text (HTML is converted to markdown). Size- and time-capped; private and loopback hosts are rejected.',
    schema: webFetchArgs
  },
  subagent: {
    description:
      'Delegate a read-only investigation to a nested agent that returns one written report. Use it for open-ended searching whose intermediate output you do not need; it cannot edit files or run commands, and it cannot start further sub-agents.',
    schema: subagentArgs
  },
  terminal: {
    description:
      'Run a shell command with cwd set to the workspace root. Output is capped. On Windows this uses cmd.exe — prefer cmd-safe commands (dir, findstr, where, type); do not use ls/grep/head/find/cat/which unless bash is available.',
    schema: terminalArgs
  },
  memory_list: {
    description:
      'List long-term memory under .vyotiq/memory/: index excerpt, note names, and whether state.md exists. Not RAG — explicit files only.',
    schema: memoryListArgs
  },
  memory_read: {
    description:
      'Read a memory file: index.md, state.md, or notes/<name>.md under .vyotiq/memory/.',
    schema: memoryReadArgs
  },
  memory_write: {
    description:
      'Create or update a memory file (index.md, state.md, or notes/<name>.md). Write durable facts when learned — prefs, architecture, decisions. Never store secrets.',
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
