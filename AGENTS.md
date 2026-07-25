# AGENTS.md

## Cursor Cloud specific instructions

Vyotiq Agent V is a single **Electron desktop app** (Electron 43 · electron-vite · React 19 · TS · Tailwind 4). There is no server/backend service — everything runs inside the one Electron process. Standard commands live in `README.md` and `package.json` scripts (`pnpm dev`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, `pnpm build`, `pnpm start`); refer to those rather than duplicating.

Dependencies are refreshed by the startup update script (`pnpm install`); its `postinstall` runs `electron/install.js` + `electron-builder install-app-deps` (native rebuild). Don't re-add install steps here.

### Running the GUI in this headless VM
- A virtual X display is available at `DISPLAY=:1`. Launch the app with `DISPLAY=:1 LIBGL_ALWAYS_SOFTWARE=1 <cmd>` — GPU is blocklisted, so software GL avoids blank/paint issues.
- The repeated `dbus/bus.cc`, `GpuControl.CreateCommandBuffer`, and `WebGL1 blocklisted` errors in the log are **harmless** in this environment; ignore them.
- The app uses `app.requestSingleInstanceLock()`: only **one** Electron instance can run at a time. A stray `pnpm dev` instance will make a subsequent `pnpm start` silently quit. Kill leftover `electron/dist/electron .` processes by PID before relaunching (never `pkill`).
- For CDP inspection, pass `-- --remote-debugging-port=9222` to the pnpm command and drive via `http://localhost:9222/json` (Node 22 has a global `WebSocket`).

### Non-obvious: `pnpm dev` renderer stays blank; use `pnpm start` to see the UI
- In dev, `boot()` (`src/renderer/src/main.tsx`) awaits `import('electron-log/renderer')` (`src/renderer/src/logging/init.ts`) before mounting React. Under the vite dev server this dynamic import **never resolves**: electron-log's default export is a `Proxy`, vite marks the dep `needsInterop`, and the generated interop wrapper (which reads `m.default.__esModule` on that Proxy) deadlocks. Result: `#root` stays empty (blank white window) even though the main process, preload, IPC, and all 160 module requests load with no errors.
- The **production bundle is unaffected** (imports are statically bundled). To run and manually test the rendered app, build then preview: `pnpm build` then `DISPLAY=:1 LIBGL_ALWAYS_SOFTWARE=1 pnpm start`. This renders the full UI and exercises real IPC / the agent loop.
- This is a code/dependency-interop issue, not an environment gap. A fix would live in `electron.vite.config.ts` / the renderer boot code (e.g. exclude `electron-log/renderer` from dev optimize-interop or avoid the dynamic import), but is out of scope for environment setup.

### Providers for end-to-end chat testing
- Cloud providers (OpenAI/Anthropic/etc.) need API keys (none are set in the env; egress to their APIs works). The app stores keys via OS `safeStorage` (Settings → Providers).
- **Ollama** is the only zero-key local option. Note a repo bug: the Ollama provider double-appends `/v1`, so requests go to `…/v1/v1/chat/completions` (and model-list to `…/v1/v1/…`) and 404 out of the box. To drive a real local chat, run a small rewrite proxy that maps `/v1/v1/` → `/v1/` and `/v1/api/` → `/api/` in front of `127.0.0.1:11434`, and set `ollamaBaseUrl` (in `~/.config/vyotiq/settings.json`, the userData dir) to the proxy using an explicit `127.0.0.1` host (the app resolves `localhost` to IPv6). Live model listing still 404s (falls back to seed defaults) but chat works.

### Runtime data location
- Run state (settings, secrets, sessions, logs) lives under `~/.config/vyotiq/` (Linux userData), **not** in the repo. Project-local agent memory is under `{workspace}/.vyotiq/memory/`.
