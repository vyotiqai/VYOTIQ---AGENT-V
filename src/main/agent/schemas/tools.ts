import { z } from 'zod'
import type { ToolDefinition } from '../providers/types'
import { zodToJsonSchema } from './zodToJsonSchema'

const readArgs = z.object({
  path: z.string().describe('Relative or absolute path inside the workspace'),
  offset: z
    .number()
    .optional()
    .describe('Byte offset for partial reads of large files (default 0)'),
  limit: z
    .number()
    .optional()
    .describe('Max bytes to read from offset (for large files)')
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
