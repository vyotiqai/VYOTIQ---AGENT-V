# Vyotiq Agent V

Lean Electron desktop coding agent: natural-language harness, workspace tools, multi-provider chat, live context management, and file-backed long-term memory. Includes a built-in live agent browser (navigate, snapshot, click, type). No terminal UI, embedding RAG, or GitHub.

## Stack

- Electron **43.2.0** · pnpm · electron-vite · React 19 · TypeScript · Tailwind CSS 4
- Zod-validated IPC · `safeStorage` for API keys
- Plus Jakarta Sans + JetBrains Mono · AAA neutral grayscale (light/dark)
- Frameless window (`titleBarStyle: hidden` / overlay)

## Setup

```bash
pnpm install
pnpm dev
```

## Scripts

| Script | Purpose |
|--------|---------|
| `pnpm dev` | Dev app with HMR |
| `pnpm typecheck` | `tsc` for main + renderer |
| `pnpm test` | Unit, integration, and renderer tests |
| `pnpm build` | Production bundle → `out/` |
| `pnpm pack:win` / `pack:mac` / `pack:linux` | Platform installers |

## Smoke test

1. Start [Ollama](https://ollama.com) and `ollama pull qwen2.5` (or set an API key in Settings).
2. `pnpm dev` → pick a workspace → send a message.
3. Confirm tool rows (`read` / `search` / `memory_*` / …), streaming text, and **Stop** cancels the run.

## Providers (9)

OpenAI · Anthropic · Gemini · Ollama · DeepSeek · Groq · OpenRouter · xAI · Mistral

- **Extended thinking:** Reasoning-capable models stream a separate thinking channel (collapsed in chat). Configure in the composer **model picker** (thinking on/off, effort, show/hide), along with compaction.
- **OpenAI** reasoning models use the **Responses API** (`/v1/responses`) with reasoning summaries and tool-loop continuity.
- **Gemini** thinking models use the **Interactions API** (`/v1beta/interactions`) with stateful `previous_interaction_id`.
- **Anthropic** uses **Messages API** extended/adaptive thinking; **DeepSeek** and **OpenRouter** use Chat Completions with `reasoning_content` / `reasoning` replay on tool steps.
- Non-thinking models keep **Chat Completions / Messages / streamGenerateContent** paths.
- Composer and Settings load **live models** via `models:list` (5‑minute cache). Seed catalogs are offline fallbacks only.
- Image attach on user turns (data URLs). Ollama accepts **base64 only** (no remote image URLs).
- Non-vision models strip image parts to a text marker before the provider call; Composer prefers a vision-capable model when images are attached.

## Context + memory

- Universal client context pipeline: budget layers, tool-result trimming, structured compaction, workspace snapshot, always-on memory index + state injection, live context-window meter in the composer.
- Read-only built-in tools may run in parallel when the model requests multiple calls in one step. MCP tools always run serially and are not auto-exempt from approval via `readOnlyHint` (session/workspace allowlists can still skip prompts).
- **Marketplace** (sidebar): Discover / Featured catalog for MCP servers, skills, and plugins; Manage installs and configures them (stdio / HTTP / SSE). Settings → Registry holds the optional remote catalog URL. Enabled skills inject into the system prompt; plugins expand nested MCP + skills + rules.
- Anthropic also sends server `cache_control` + `context_management` (`clear_tool_uses` / `compact`) when available.
- Long-term memory lives at `{workspace}/.vyotiq/memory/` (`index.md`, `notes/*.md`, optional `state.md`) with tools `memory_list` / `memory_read` / `memory_write`.

**Memory is not RAG** — no embeddings or vector search. Agents write and read explicit markdown files.

## Layout

See [docs/architecture.md](docs/architecture.md) for process boundaries, import aliases (`@shared`, `@renderer/lib`, `@main`), feature folder conventions, and the composer variant contract.

```
src/main/          # window, security, IPC, secrets, agent loop / tools / providers / context / logging
src/preload/       # contextBridge API (+ optional Sentry renderer bridge)
src/shared/        # Zod IPC contracts, channels, AppError, logger facade, scrubber
src/renderer/      # React UI (sidebar + chat + settings + ErrorBoundary)
resources/harness/ # system agent harness (default.md — behavioral policy; per-tool how-to lives in tool defs)
```

Run state (chat sessions) lives under AppData, not in the project folder:

```
%APPDATA%/vyotiq/          # or platform userData equivalent
  workspaces.json          # open tabs, UI state, settings overrides
  settings.json
  secrets.json
  logs/
  workspaces/
    {workspaceId}/         # stable UUID from canonical workspace path
      meta.json
      sessions/
        {runId}/
          contract.md
          status.json
          messages.jsonl
          events.jsonl
```

Project-local agent memory stays at `{workspace}/.vyotiq/memory/` only. The system harness lives only in `resources/harness/default.md` (bundled with the app). Built-in tools use short capability descriptions in `src/main/agent/schemas/tools.ts`, not a duplicated harness catalog.

When adding or changing a built-in tool, update its argument schema, handler, and runtime limits/classification together. Keep the tool description as a short capability blurb; `tests/main/unit/toolsSchema.test.ts` checks registry/handler parity and the harness boundary.

**Run file contract:** `messages.jsonl` is the canonical chat transcript (one JSON object per line: user/assistant/tool messages). `events.jsonl` is an append-only ops log (`status`, `step_usage`, `context_usage`, etc. with ISO `at` timestamps); full tool output is stored only in `messages.jsonl`. The UI rebuilds the chat timeline from `messages.jsonl` on reload and shows run telemetry in the Activity panel. Legacy session-only runs under `{userData}/sessions/` are migrated into the workspace AppData sessions folder on first startup.

Copy `.env.example` → `.env` if you want an optional Sentry DSN locally (gitignored).

## Security

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- Paths sandboxed to the workspace root; memory tools stay under `.vyotiq/memory/`; secrets via OS `safeStorage`
- CSP + navigation locks on the BrowserWindow

## Logging & telemetry

- **Always on:** structured rotating logs under `{userData}/logs/` (`vyotiq.log`), via `electron-log` across main + renderer. Logs record **Vyotiq system telemetry only** (error codes, tool names, run IDs, opaque workspace IDs) — never workspace paths, file names, search queries, terminal commands, or chat/tool payloads.
- Open the folder from **Settings → General → Open logs folder**.
- **Optional Sentry:** only when both a build-time DSN and Settings → “Share crash & error reports” are enabled (default **off**). No Session Replay; the same no-user-data policy applies (allowlisted fields + secret scrubbing).
- Set either env var before `pnpm dev` / pack (do not commit secrets):

```bash
# Main process
SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>

# Renderer (same value is fine; electron-vite also maps SENTRY_DSN → VITE_SENTRY_DSN)
VITE_SENTRY_DSN=https://<key>@o<org>.ingest.sentry.io/<project>
```

## Scope (kept lean)

Tools: `read` · `list_dir` · `glob` · `grep` · `search` · `edit` · `str_replace` · `multi_edit` · `delete` · `todo_write` · `web_fetch` · `web_search` · `browser_navigate` · `browser_snapshot` · `browser_scroll` · `browser_click` · `browser_type` · `browser_fill` · `subagent` · `terminal` · `git_status` · `git_diff` · `diagnostics` · `memory_list` · `memory_read` · `memory_write` (no terminal panel).
