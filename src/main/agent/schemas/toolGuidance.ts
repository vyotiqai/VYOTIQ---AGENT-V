import {
  READ_CONTENT_CAP,
  READ_DIR_LIST_CAP,
  READ_LINE_RANGE_MAX_BYTES
} from '../tools/read'
import { LIST_DIR_CAP } from '../tools/listDir'
import { TERMINAL_MAX_OUTPUT, TERMINAL_MAX_TIMEOUT_MS } from '../tools/terminal'
import { MEMORY_WRITE_CAP } from '../tools/memory'
import { GLOB_DEFAULT_MAX_RESULTS, GLOB_SCAN_CAP } from '../tools/glob'
import { GREP_MAX_FILE_BYTES, GREP_MAX_LINE_CHARS, GREP_SCAN_CAP } from '../tools/grep'
import {
  SEARCH_DEFAULT_MAX_RESULTS,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_SCAN_CAP
} from '../tools/search'
import {
  WEB_FETCH_DEFAULT_MAX_CHARS,
  WEB_FETCH_DEFAULT_TIMEOUT_MS,
  WEB_FETCH_MAX_BYTES,
  WEB_FETCH_MAX_TIMEOUT_MS
} from '../tools/webFetch'

import { MAX_PARALLEL_SUBAGENTS } from '../tools/classify'
import { MEMORY_LIST_INDEX_EXCERPT } from '../context/memory'

const READ_KIB = READ_CONTENT_CAP / 1024
const READ_LINE_MIB = READ_LINE_RANGE_MAX_BYTES / (1024 * 1024)
const TERM_KIB = TERMINAL_MAX_OUTPUT / 1024
const TERM_MAX_TIMEOUT_SECONDS = TERMINAL_MAX_TIMEOUT_MS / 1000
const MEM_KIB = MEMORY_WRITE_CAP / 1024
const GREP_FILE_KIB = GREP_MAX_FILE_BYTES / 1024
const SEARCH_FILE_KIB = SEARCH_MAX_FILE_BYTES / 1024
const WEB_MIB = WEB_FETCH_MAX_BYTES / (1024 * 1024)

/**
 * Structured, model-facing usage guidance for each built-in tool.
 * Kept out of the harness so it rides the always-kept tools API channel.
 * Numbers are imported from implementation constants — keep them in sync via tests.
 */
export const TOOL_GUIDANCE = {
  read: `Read a file under the workspace root (text only). Directories return a shallow listing.

LIMITS:
- Full-file read errors above ${READ_KIB} KiB (${READ_CONTENT_CAP} bytes); use startLine/endLine or offset/limit.
- Line-range requires the file on disk to be ≤ ${READ_LINE_MIB} MiB (${READ_LINE_RANGE_MAX_BYTES} bytes).
- Tool result content is always capped at ${READ_KIB} KiB by the dispatcher.
- Directory listing when path is a dir is capped at ${READ_DIR_LIST_CAP} entries.`,

  edit: `Create or overwrite a workspace file with full contents, or apply a unified diff.

LIMITS:
- Path must resolve inside the workspace root.
- Exactly one of contents or diff is required.`,

  search: `Quick combined filename-or-content lookup. Default: case-insensitive substring; set regex=true for case-insensitive regex. First hit per file.

LIMITS:
- Gitignore-aware; also skips node_modules, .git, and common build dirs.
- Walks at most ${SEARCH_SCAN_CAP} workspace files (smaller than glob/grep).
- Content hits only in text files ≤ ${SEARCH_FILE_KIB} KiB; filename matches are not size-capped.
- Default maxResults ${SEARCH_DEFAULT_MAX_RESULTS}.`,

  glob: `List workspace-relative paths matching a glob (**, *, ?, {a,b}). Gitignore-aware.

LIMITS:
- Default maxResults ${GLOB_DEFAULT_MAX_RESULTS}; workspace scan cap ${GLOB_SCAN_CAP} files.
- Skips gitignored and build directories. Patterns are matched case-insensitively.`,

  grep: `Regex search across text file contents; every matching line with optional context. Default: case-insensitive.

LIMITS:
- Default maxResults 60; contextLines 0–5; default case-insensitive (set caseSensitive=true to change).
- Skips files larger than ${GREP_FILE_KIB} KiB; scan cap ${GREP_SCAN_CAP} files.
- Each reported line clipped at ${GREP_MAX_LINE_CHARS} characters.
- Ignores gitignored / build dirs; text extensions only.`,

  list_dir: `List one directory level with sizes. Gitignore- and build-dir-aware.

LIMITS:
- One level only; capped at ${LIST_DIR_CAP} entries.
- Skips gitignored and common build directories.`,

  multi_edit: `Apply several file edits atomically when planning fails: if any edit fails to validate or match, no file is written.

LIMITS:
- All paths must be inside the workspace.
- At least one edit required.
- Diff/path validation runs before any write; a mid-write disk failure could leave earlier edits on disk.`,

  delete: `Delete a workspace file, or a directory when recursive=true.

LIMITS:
- Scoped to the workspace root.
- recursive required for directories with entries.`,

  todo_write: `Record and update this run's visible task list.

LIMITS:
- Statuses: pending | in_progress | completed | cancelled.
- Only available inside an active run.`,

  web_fetch: `Fetch a public http(s) URL as text. HTML responses are converted to markdown; other text types are returned as trimmed text.

LIMITS:
- Default maxChars ${WEB_FETCH_DEFAULT_MAX_CHARS}; default timeout ${WEB_FETCH_DEFAULT_TIMEOUT_MS}ms (clamped 1000–${WEB_FETCH_MAX_TIMEOUT_MS}ms).
- Response body read capped at ${WEB_MIB} MiB before text conversion.
- Redirect hops re-checked; private hops rejected.`,

  subagent: `Delegate a read-only investigation to a nested agent that returns one written report.

LIMITS:
- Up to ${MAX_PARALLEL_SUBAGENTS} sub-agents may run in parallel.
- Reports are returned in full; write a complete, self-contained summary.
- Optional dedicated sub-agent model may be configured; otherwise uses the parent model.
- Rely on returned reports rather than re-reading files the sub-agent already covered.`,

  terminal: `Run a shell command with cwd at the workspace root. Output is capped.

LIMITS:
- stdout and stderr each capped at ${TERM_KIB} KiB (${TERMINAL_MAX_OUTPUT} bytes).
- Default timeoutMs 60000; requested timeouts are capped at ${TERM_MAX_TIMEOUT_SECONDS} seconds (${TERMINAL_MAX_TIMEOUT_MS}ms).
- Commands can still reach absolute paths outside the workspace — do not use that to read secrets.`,

  memory_list: `List long-term memory under .vyotiq/memory/: index excerpt, note names, whether state.md exists.

LIMITS:
- Returns an index.md excerpt (first ${MEMORY_LIST_INDEX_EXCERPT} chars) plus note names and state presence.`,

  memory_read: `Read a memory file: index.md, state.md, or notes/<name>.md under .vyotiq/memory/.

LIMITS:
- Content size follows the shared read cap (${READ_KIB} KiB) when surfaced through the dispatcher.`,

  memory_write: `Create or update a memory file (index.md, state.md, or notes/<name>.md).

LIMITS:
- Write capped at ${MEM_KIB} KiB (${MEMORY_WRITE_CAP} chars).
- path must be index.md, state.md, or notes/<safe-name>.md.`
} as const

export type GuidedToolName = keyof typeof TOOL_GUIDANCE
