---
name: electron-workflow
description: Use when changing Electron main/renderer code, IPC, packaging, or desktop UX in this stack.
version: 1.0.0
---

# Electron workflow

When working on an Electron + Vite app:

1. Confirm whether the change belongs in main, preload, renderer, or shared.
2. Update IPC schemas and handlers together; keep types in sync.
3. Avoid Node APIs in the renderer; go through preload bridges.
4. Test the affected path after rebuild when IPC or main-process code changes.
5. Keep packaging and path assumptions explicit (dev vs packaged resources).
6. Prefer small, verified patches over broad process rewrites.
