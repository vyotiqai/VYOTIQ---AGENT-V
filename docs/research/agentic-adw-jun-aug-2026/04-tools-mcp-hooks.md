# Tools, MCP, and hooks

**Research pass:** 2026-08-02  
**Sources:** S6, S10, S12 (MCP 2026-07-28), S13 (permissions), S14 (hooks), industry secondary marked.

## Claude Code layering (Verified primary — May 2026)

Anthropic build order for large codebases ([blog 2026-05-14](https://claude.com/blog/how-claude-code-works-in-large-codebases-best-practices-and-where-to-start)):

1. **CLAUDE.md / memory** — short, always-on map  
2. **Hooks** — deterministic PreToolUse / PostToolUse / Stop / …  
3. **Skills** — on-demand procedures (progressive disclosure)  
4. **Plugins** — portable bundles (skills + hooks + MCP config)  
5. **MCP** — external systems; prefer after basics work  
Plus **LSP** (symbol accuracy) and **subagents** (context isolation).

| Component | Loads | Best for | Common mistake |
|-----------|-------|----------|----------------|
| CLAUDE.md | Every session | Conventions, map | Stuffing reusable expertise that belongs in skills |
| Hooks | Event-triggered | Automating checks; continuous improvement | Using prompts for must-run behavior |
| Skills | On demand | Task-type SOPs | Loading everything into CLAUDE.md |
| Plugins | Once installed | Org distribution | Tribal one-off setups |
| MCP | Always once configured | Internal tools/data Claude can’t reach | Building MCP before memory/hooks |
| Subagents | When invoked | Explore vs edit; parallel side work | Exploration + editing in one window |

## Hooks = code actor (Verified primary)

Official [hooks guide](https://code.claude.com/docs/en/hooks-guide) / [hooks reference](https://code.claude.com/docs/en/hooks):

- Hooks are user-defined shell/HTTP/prompt/agent handlers at lifecycle points → **deterministic control**, not LLM choice.  
- Canonical patterns: **PostToolUse** `Edit|Write` → format (e.g. Prettier); **PreToolUse** → guardrails; **Stop** → end-of-turn scans when Bash may have written files.  
- **Exit 2** (or JSON `decision: "block"` on some events) blocks and feeds stderr/reason to the model.  
- **PostToolUse cannot undo** a successful tool call — guard before; observe/clean after.  
- Deny **permission rules always beat** hook `"allow"` ([permissions](https://code.claude.com/docs/en/permissions)).  
- MCP tools appear as normal tool names in hook matchers (`mcp__…`).  
- Hooks also fire inside subagents (`agent_id` / `agent_type` on input).  
- Worktree lifecycle: `WorktreeCreate` / `WorktreeRemove` hooks can replace git worktree logic ([worktrees](https://code.claude.com/docs/en/worktrees)).

**Event surface (2026 docs):** PreToolUse, PostToolUse, PostToolUseFailure, PostToolBatch, PermissionRequest/Denied, Stop, SubagentStart/Stop, SessionStart/End, Notification, ConfigChange, WorktreeCreate/Remove, and more — see reference for current full list. Tertiary blogs claiming “32+ events / 5 handler types” — **Verified secondary** against official docs; prefer code.claude.com as SoT.

## Permission model (Verified primary — Claude Code)

From [Configure permissions](https://code.claude.com/docs/en/permissions) (fetched 2026-08-02):

- Evaluation order: **deny → ask → allow**. First match wins; specificity does **not** reorder.  
- **Enforced by Claude Code, not the model.** CLAUDE.md / prompts do not expand authority.  
- Bare tool deny removes tool from context; scoped deny (e.g. `Bash(rm *)`) leaves tool visible but blocks matches.  
- Modes: `default` / `acceptEdits` / `plan` / `auto` / `dontAsk` / `bypassPermissions` (latter only for isolated envs; root/home `rm` still prompts).  
- MCP: deny `mcp__*`; allow per-server `mcp__server__*` / `mcp__server__tool`.  
- Bash rules are **string/prefix/wildcard**, with compound-command awareness; Anthropic documents bypass limits — treat as accident guardrails, not OS security. Combine with **sandboxing** for structural isolation.

## MCP (Verified primary — Jul 2026 spec)

[MCP Authorization Security Considerations](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations) (spec dated **2026-07-28**):

- OAuth 2.1 practices required for authn/z between client and MCP server.  
- Clients **MUST** send RFC 8707 `resource` parameter; servers **MUST** validate token audience; **MUST NOT** pass through tokens to upstream APIs.  
- PKCE (`S256` when capable); HTTPS; exact redirect URI validation.  
- Confused-deputy / token-passthrough explicitly called out.

**Important split (evidence-backed):**

| Layer | What it covers | What it does *not* cover |
|-------|----------------|--------------------------|
| MCP OAuth / audience | Who may call the MCP HTTP surface | Which *tools* a coding-agent session may invoke |
| Host permission / allowlist | Tool visibility + invocation (Claude permissions, Cursor mode policy, etc.) | Upstream OAuth token binding |

Host-side least-privilege (filter `tools/list`, deny-by-default, approval for destructive tools) is **widely recommended** in 2026 security writeups (Coalition for Secure AI PDF Mar 2026; vendor blogs). Mark those as **Verified secondary** unless tied to a specific host’s docs. Protocol itself stays “quiet” on per-tool agent policy — host must implement.

## Tool minimalism (ADW-aligned)

Grant only tools needed for the task class. Extra tools = injection surface + cognitive load. Mode allowlists (Ask / Plan / Agent) match Claude permission modes and Cursor mode policy.

Prefer **minimal edit primitives** (diff / targeted replace) for reviewable blast radius — industry practice echoed across OpenAI harness + Claude tooling; exact tool names are product-specific.

## ADW alignment table

| Mechanism | Actor | Guarantee |
|-----------|-------|-----------|
| Hook / CI / custom linter / sandbox FS policy | Code | Runs / blocks every time |
| Permission allow/deny lists | Code (host) | Independent of model intent |
| Skill markdown | Agent (advisory) | Model may skip |
| MCP tool | Agent + remote server code | Host policy + OAuth + server authz |
| CLAUDE.md / AGENTS.md / rules | Engineer → agent context | Advisory unless mirrored in hooks/CI |

## VYOTIQ note (preview — no product change)

Rich builtin + MCP surface; mode policy hard-gates; tool approval for dangerous tools. No Claude-style PostToolUse/Stop hook runner — closest analogs: in-loop tool results, diagnostics tool, human slash harness apply. Gap vs 2026 lab practice is **lifecycle hooks as code**, not more skills.
