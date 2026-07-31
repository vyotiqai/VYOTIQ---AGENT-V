import { z } from 'zod'
import { TERMINAL_MAX_TIMEOUT_MS } from '../tools/terminal'
import { USER_REGEX_MAX_LENGTH } from '../tools/safeUserRegex'
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
      .describe('Full file contents to write (prefer for new/small files). Mutually exclusive with diff.')
      .optional(),
    diff: z
      .string()
      .describe('Unified diff with @@ hunks (use when editing an existing file without rewriting it). Mutually exclusive with contents.')
      .optional()
  })
  .refine(
    (args) =>
      typeof args.contents === 'string' ||
      (typeof args.diff === 'string' && args.diff.trim().length > 0),
    { message: 'edit requires contents or diff' }
  )
  .refine(
    (args) => !(typeof args.contents === 'string' && typeof args.diff === 'string' && args.diff.trim()),
    { message: 'edit accepts contents or diff, not both', path: ['diff'] }
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

const TERMINAL_SESSION_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Drop invented session_id labels when a command is also present (poll footgun). */
function coerceTerminalSessionId(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw
  const v = raw as Record<string, unknown>
  const sid = typeof v.session_id === 'string' ? v.session_id.trim() : ''
  const cmd = typeof v.command === 'string' ? v.command.trim() : ''
  if (sid && cmd && !TERMINAL_SESSION_UUID_RE.test(sid)) {
    const { session_id: _drop, ...rest } = v
    return rest
  }
  return raw
}

const terminalArgs = z.preprocess(
  coerceTerminalSessionId,
  z
    .object({
      command: z
        .string()
        .describe(
          'Shell command to run at workspace root. Required to start; omit when polling an existing session_id. Shell comes from Settings → Agent → Terminal shell.'
        )
        .optional(),
      working_directory: z
        .string()
        .describe(
          'Optional subdirectory inside the workspace for cwd (default: workspace root). Must resolve inside the workspace.'
        )
        .optional(),
      session_id: z
        .string()
        .uuid()
        .describe(
          'Only the session_id UUID from a prior terminal tool result (background start). Never invent labels; omit session_id and pass command for a new shell.'
        )
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
        .max(USER_REGEX_MAX_LENGTH)
        .describe(
          `Optional regex matched against combined stdout+stderr; return early when matched (max ${USER_REGEX_MAX_LENGTH} chars)`
        )
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
)

const gitCommitArgs = z.object({
  message: z.string().min(1).describe('Commit message'),
  push: z
    .boolean()
    .describe('Also push to origin after commit (default false)')
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
  pattern: z
    .string()
    .max(USER_REGEX_MAX_LENGTH)
    .describe(`Regular expression matched against each line (max ${USER_REGEX_MAX_LENGTH} chars)`),
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
    .superRefine((edits, ctx) => {
      const seen = new Set<string>()
      for (let i = 0; i < edits.length; i++) {
        const path = edits[i]?.path?.trim()
        if (!path) continue
        const key = path.replace(/\\/g, '/').toLowerCase()
        if (seen.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate path "${edits[i]!.path}" — combine into one edit`,
            path: [i, 'path']
          })
        }
        seen.add(key)
      }
    })
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
          .describe('Task status: pending, in_progress, completed, or cancelled.')
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

const browserTabIdArg = z
  .string()
  .min(1)
  .describe('Optional tab id from browser_tabs / navigate (default: active tab)')
  .optional()

const browserSettleMsArg = z
  .number()
  .int()
  .min(0)
  .describe('Post-action settle wait in ms (default 400)')
  .optional()

const browserNavigateArgs = z.object({
  url: z
    .string()
    .describe('Absolute http(s) URL to open in the built-in agent browser. Private/loopback hosts are rejected.'),
  timeoutMs: z
    .number()
    .int()
    .min(1000)
    .describe('Navigation timeout in ms (default 30000)')
    .optional(),
  tab_id: browserTabIdArg
})

const browserSnapshotArgs = z.object({
  maxChars: z
    .number()
    .int()
    .min(1000)
    .describe('Cap on returned page text (default 40000)')
    .optional(),
  tab_id: browserTabIdArg
})

const browserClickArgs = z.object({
  selector: z
    .string()
    .min(1)
    .describe('CSS selector or snapshot ref (@e12) from the latest browser_snapshot.'),
  button: z
    .enum(['left', 'right', 'middle'])
    .describe('Mouse button (default left)')
    .optional(),
  tab_id: browserTabIdArg,
  settleMs: browserSettleMsArg
})

const browserTypeArgs = z.object({
  text: z.string().describe('Text to type into the focused (or selected) element.'),
  selector: z
    .string()
    .min(1)
    .describe('Optional CSS selector or snapshot ref (@e12) to focus before typing')
    .optional(),
  clear: z.boolean().describe('Select-all and delete before typing (default false)').optional(),
  pressEnter: z.boolean().describe('Press Enter after typing (default false)').optional(),
  tab_id: browserTabIdArg,
  settleMs: browserSettleMsArg
})

const browserScrollArgs = z.object({
  selector: z
    .string()
    .min(1)
    .describe('Optional CSS selector or @eN ref to scroll into view')
    .optional(),
  deltaX: z.number().describe('Horizontal scroll delta in pixels').optional(),
  deltaY: z.number().describe('Vertical scroll delta in pixels').optional(),
  tab_id: browserTabIdArg,
  settleMs: browserSettleMsArg
})

const browserFillArgs = z.object({
  selector: z
    .string()
    .min(1)
    .describe('CSS selector or snapshot ref (@e12) of an input, textarea, or contenteditable.'),
  value: z.string().describe('Full value to set (replaces existing content).'),
  pressEnter: z.boolean().describe('Press Enter after filling (default false)').optional(),
  tab_id: browserTabIdArg,
  settleMs: browserSettleMsArg
})

const browserTabsArgs = z.object({
  action: z.enum(['list', 'open', 'close', 'select']).describe('Tab action to perform'),
  tab_id: browserTabIdArg,
  url: z
    .string()
    .describe('Optional URL to load when action is open')
    .optional()
})

const browserBackArgs = z.object({ tab_id: browserTabIdArg })
const browserForwardArgs = z.object({ tab_id: browserTabIdArg })

const browserWaitForSelectorArgs = z.object({
  selector: z.string().min(1).describe('CSS selector or @eN ref to wait for'),
  timeoutMs: z.number().int().min(100).describe('Wait timeout in ms (default 15000)').optional(),
  tab_id: browserTabIdArg
})

const browserWaitForUrlArgs = z.object({
  match: z.string().min(1).describe('Substring or regex pattern the page URL must match'),
  regex: z.boolean().describe('Treat match as a regex (default false)').optional(),
  timeoutMs: z.number().int().min(100).describe('Wait timeout in ms (default 15000)').optional(),
  tab_id: browserTabIdArg
})

const browserPressKeyArgs = z.object({
  key: z.string().min(1).describe('Key code to press (e.g. Enter, Escape, Tab, a)'),
  modifiers: z
    .array(z.string())
    .describe('Optional modifiers: control, shift, alt, meta')
    .optional(),
  tab_id: browserTabIdArg,
  settleMs: browserSettleMsArg
})

const browserSelectOptionArgs = z
  .object({
    selector: z.string().min(1).describe('CSS selector or @eN ref of a <select>'),
    value: z.string().describe('Option value to select').optional(),
    label: z.string().describe('Option visible label to select').optional(),
    pressEnter: z.boolean().describe('Press Enter after selecting (default false)').optional(),
    tab_id: browserTabIdArg,
    settleMs: browserSettleMsArg
  })
  .refine((v) => Boolean(v.value?.trim()) || Boolean(v.label?.trim()), {
    message: 'Provide value or label for browser_select_option'
  })

const mcpListToolsArgs = z.object({
  serverId: z
    .string()
    .describe('Optional MCP server id filter (exact match on server id)')
    .optional(),
  server_id: z
    .string()
    .describe('Deprecated alias for serverId')
    .optional()
})

const requestMcpToolsArgs = z.object({
  tools: z
    .array(z.string().min(1).max(200))
    .max(32)
    .describe(
      'Full MCP tool names (mcp__server__tool) and/or bare tool names to pin for the next step'
    )
    .optional(),
  serverId: z
    .string()
    .describe('Pin every connected tool from this MCP server id for the next step')
    .optional(),
  server_id: z.string().describe('Deprecated alias for serverId').optional()
})

const mcpListResourcesArgs = z.object({
  serverId: z
    .string()
    .describe('Optional MCP server id (omit to list all connected enabled servers)')
    .optional()
})

const mcpReadResourceArgs = z.object({
  serverId: z.string().min(1).describe('MCP server id'),
  uri: z.string().min(1).describe('Resource URI to read')
})

const mcpListPromptsArgs = z.object({
  serverId: z
    .string()
    .describe('Optional MCP server id (omit to list all connected enabled servers)')
    .optional()
})

const mcpGetPromptArgs = z.object({
  serverId: z.string().min(1).describe('MCP server id'),
  name: z.string().min(1).describe('Prompt name'),
  arguments: z
    .record(z.string(), z.string())
    .describe('Prompt argument values')
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

const askQuestionItemArgs = z.object({
  id: z.string().min(1).describe('Stable id used to match the answer'),
  prompt: z.string().min(1).describe('Question text shown to the user'),
  type: z
    .enum(['single', 'multi', 'boolean', 'text'])
    .describe('single=one option; multi=many; boolean=yes/no; text=freeform'),
  options: z
    .array(z.string().min(1))
    .min(2)
    .describe('Required for single/multi (at least 2 choices)')
    .optional(),
  allowCustom: z
    .boolean()
    .describe('For single/multi, allow an Other… text answer (default false)')
    .optional()
})

const askQuestionArgs = z
  .object({
    title: z
      .string()
      .min(1)
      .describe('Optional form title when asking multiple questions')
      .optional(),
    questions: z
      .array(askQuestionItemArgs)
      .min(1)
      .max(8)
      .describe('Typed question form (1–8 items). Prefer this over legacy fields.')
      .optional(),
    question: z
      .string()
      .min(1)
      .describe('Legacy single-question text when questions[] is omitted')
      .optional(),
    options: z
      .array(z.string().min(1))
      .describe('Legacy fixed choices for a single question')
      .optional(),
    allowMultiple: z
      .boolean()
      .describe('Legacy: allow selecting more than one option (default false)')
      .optional(),
    allowCustom: z
      .boolean()
      .describe('Legacy: allow a custom text answer with options (default true)')
      .optional()
  })
  .superRefine((val, ctx) => {
    if ((!val.questions || val.questions.length === 0) && !val.question?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide questions[] or question'
      })
    }
  })

const switchModeArgs = z.object({
  mode: z
    .enum(['ask', 'plan', 'agent'])
    .describe('Target interaction mode for the rest of this run')
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
      'Create/overwrite with contents (new or small files), or apply a unified diff. For one exact string change use str_replace; for several files use multi_edit.',
    schema: editArgs
  },
  search: {
    description:
      'Quick filename-or-content substring lookup (first hit per file). Prefer glob for path patterns and grep for every matching line.',
    schema: searchArgs
  },
  glob: {
    description:
      'List workspace-relative paths matching a glob (**, *, ?, {a,b}). Prefer over search when you need paths only. Gitignore-aware.',
    schema: globArgs
  },
  grep: {
    description:
      'Regex search across file contents with every matching line and optional context. Prefer over search when you need all hits or line numbers.',
    schema: grepArgs
  },
  list_dir: {
    description: 'List one directory level with sizes. Gitignore- and build-dir-aware.',
    schema: listDirArgs
  },
  multi_edit: {
    description:
      'Apply several file edits atomically (one entry per path). Prefer when changing multiple files; use str_replace for a single surgical change.',
    schema: multiEditArgs
  },
  str_replace: {
    description:
      'Replace exact text in a file (unique old_string, or replace_all). Prefer for one surgical edit; use edit for new files or multi_edit for many files.',
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
  browser_tabs: {
    description:
      'Manage agent-browser tabs: list, open (optional url), close, or select by tab_id.',
    schema: browserTabsArgs
  },
  browser_back: {
    description: 'Go back in the active (or specified) agent-browser tab history.',
    schema: browserBackArgs
  },
  browser_forward: {
    description: 'Go forward in the active (or specified) agent-browser tab history.',
    schema: browserForwardArgs
  },
  browser_wait_for_selector: {
    description:
      'Poll until a CSS selector or @eN ref is present and interactable, or timeout.',
    schema: browserWaitForSelectorArgs
  },
  browser_wait_for_url: {
    description: 'Poll until the page URL matches a substring or regex, or timeout.',
    schema: browserWaitForUrlArgs
  },
  browser_press_key: {
    description: 'Press a keyboard key (with optional modifiers) in the agent browser.',
    schema: browserPressKeyArgs
  },
  browser_select_option: {
    description: 'Select an option in a <select> by value or visible label.',
    schema: browserSelectOptionArgs
  },
  mcp_list_tools: {
    description:
      'List connected MCP tools (name, description, readOnlyHint). Marks tools omitted from this step catalog. Use request_mcp_tools to pin omitted tools for the next step.',
    schema: mcpListToolsArgs
  },
  request_mcp_tools: {
    description:
      'Pin MCP tool definitions into the next step provider catalog (budget-permitting). Effect applies on the following step, not mid-stream. Pass full mcp__server__tool names and/or a serverId.',
    schema: requestMcpToolsArgs
  },
  mcp_list_resources: {
    description:
      'List MCP resources (uri, name, description) from one server or all connected enabled servers.',
    schema: mcpListResourcesArgs
  },
  mcp_read_resource: {
    description: 'Read an MCP resource by server id and URI.',
    schema: mcpReadResourceArgs
  },
  mcp_list_prompts: {
    description:
      'List MCP prompts (name, description, arguments) from one server or all connected enabled servers.',
    schema: mcpListPromptsArgs
  },
  mcp_get_prompt: {
    description: 'Fetch a rendered MCP prompt by server id and name (optional arguments).',
    schema: mcpGetPromptArgs
  },
  subagent: {
    description:
      'Delegate a read-only investigation to a nested agent. Returns one report and persists it under subagents/<id>/report.md for re-read after compaction.',
    schema: subagentArgs
  },
  ask_question: {
    description:
      'Pause and ask the user a typed question form in the transcript (single, multi, boolean, text; up to 8 questions). Blocks until they answer.',
    schema: askQuestionArgs
  },
  switch_mode: {
    description:
      'Switch this run between Ask (read-only), Plan (plan artifacts only), and Agent (full tools).',
    schema: switchModeArgs
  },
  terminal: {
    description:
      'Run a shell command with cwd at the workspace root (or working_directory under it). Output is capped. Use block_until_ms: 0 to start in the background (returns session_id: <uuid>); poll only with that UUID plus block_until_ms / pattern. Never invent session_id labels — omit session_id and pass command for a new shell.',
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
  git_commit: {
    description:
      'Stage all changes and create a git commit (optional push). Agent-only; requires approval when enabled.',
    schema: gitCommitArgs
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
