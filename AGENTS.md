<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

This project has a knowledge graph MCP (code-review-graph). When those tools are
connected they can provide structural context (callers, dependents, coverage);
they are optional — Grep/Glob/Read are fine when the graph is absent, trimmed, or
not needed.

### Useful graph tools (when available)

- Exploring: `semantic_search_nodes_tool` or `query_graph_tool`
- Impact: `get_impact_radius_tool`
- Review: `detect_changes_tool` + `get_review_context_tool`
- Relationships: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- Architecture: `get_architecture_overview_tool` + `list_communities_tool`

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Risk-scored change analysis |
| `get_review_context_tool` | Token-efficient review snippets |
| `get_impact_radius_tool` | Blast radius of a change |
| `get_affected_flows_tool` | Impacted execution paths |
| `query_graph_tool` | Callers, callees, imports, tests, deps |
| `semantic_search_nodes_tool` | Find functions/classes by name or keyword |
| `get_architecture_overview_tool` | High-level structure |
| `refactor_tool` | Renames / dead code discovery |

The graph auto-updates on file changes when hooks are configured.

## Build and verification

- `pnpm typecheck` — `tsc` for main + renderer.
- `pnpm test` — full Vitest suite (main, renderer, shared; can take several minutes).
- `pnpm build` — `pnpm sync:file-icons && pnpm typecheck && electron-vite build`.
- `pnpm start` / `pnpm dev` — `electron-vite preview` / dev. In this environment `pnpm start` currently fails during Electron launch with `TypeError: Cannot read properties of undefined (reading 'isPackaged')` inside `@electron-toolkit/utils`; the production `pnpm build` succeeds.
