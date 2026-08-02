# Best practices, patterns, and approaches (2026)

**Research date:** 2026-08-01  
**Audience:** Implementers extending VYOTIQ providers, context, and agent tooling.  
**Sources:** [sources.md](./sources.md). Align with existing project rules (no hard agent step limits; ask before expanding scope).

---

## 1. Provider integration patterns

### Prefer live catalogs; keep seeds honest

- **Runtime:** Always call provider `listModels` when a key (or local daemon) is available.
- **Fallback:** Seeds should list **current GA defaults**, not historical demos — they become the UI when the network fails.
- **Cache:** Keep short memory TTL + longer disk TTL (VYOTIQ: 5 min / 7 day) with generation tokens so stale inflight fetches cannot overwrite fresher results.
- **Context windows:** Maintain a `knownContextWindow` table for providers that omit `context_length` (DeepSeek pattern). Prefer exact IDs, then prefix patterns.

### OpenAI-compatible adapters

- Treat Chat Completions as the **lowest common denominator** for DeepSeek/Groq/xAI/Mistral/Ollama/specialists.
- Centralize in one factory (`createOpenAiCompatibleProvider`) with opt-in flags: vision base64-only, thinking body shape, `stream_options.include_usage`, OpenRouter retry stripping.
- For new hosts (Cerebras, Fireworks, Together): prefer a **single Custom OpenAI-compat provider** (base URL + key + optional headers) over one-off IDs until enterprise demand justifies first-class branding.

### Protocol routing

| When | Prefer |
|------|--------|
| OpenAI thinking / reasoning models | Responses API (already) |
| OpenAI general agent turns (future) | Consider Responses-default for models that support tools + reasoning for better cache hits |
| Anthropic | Messages API + cache_control + optional server compaction |
| Gemini thinking | Interactions API |
| Everything else | Chat Completions |

Do not invent dual code paths per model without a `thinkingApi` (or equivalent) discriminator.

### Enterprise gateways

- Azure / Bedrock / Vertex are **auth + region + deployment** problems, not just another Bearer key.
- Feature-detect carefully: Bedrock OpenAI-compat often lacks computer use / hosted tools present on first-party OpenAI.
- Store cloud credentials with the same secret store; never log keys; scrub in error paths.

---

## 2. Prompt caching & cost control

1. **Stable system prefix** — Assemble harness + rules + skill metadata in a stable order so Anthropic/OpenAI caches hit (VYOTIQ already aims for stable system-prefix assembly).
2. **Explicit breakpoints (OpenAI GPT-5.6+)** — Mark the end of reusable prefix content; allow varying user/history after the breakpoint without busting the cache.
3. **Anthropic `cache_control`** — Mark the last static block of the prefix; avoid changing tool defs mid-turn unless using mid-conversation tool-change betas that preserve cache.
4. **Meter cache** — Surface `cachedInputTokens` / cache-write tokens in UI when providers report them (VYOTIQ already tracks some usage fields).
5. **Model routing** — Prefer Luna/Flash/Haiku-class for high-volume tool loops; reserve Sol/Opus/Pro for hard reasoning. Coding-agent comparisons stress **tool choice by task**, not one model for everything.
6. **Service / Fast tiers** — Use Fast/priority only when wall-clock matters; document 2× price tradeoffs in Settings copy.

---

## 3. Tooling & MCP patterns

### Client tools vs hosted tools

| Approach | Pros | Cons |
|----------|------|------|
| **Client-executed tools** (VYOTIQ default) | Full control, works across all providers, workspace-aware | More engineering; model must learn custom schemas |
| **Provider-hosted tools** (computer use, code exec, file search) | Models trained on exact schemas; less client code | Provider lock-in; sandbox not your filesystem |

**Recommended approach for VYOTIQ:** Keep client tools as the product spine. Add provider-hosted tools only as **optional accelerators** behind provider capability flags, never as the only path.

### MCP

- Namespace as `mcp__{server}__{tool}`; never trust `readOnlyHint` for approval exemption or Ask-mode invoke (VYOTIQ security stance).
- Budget-trim MCP defs; expose pin/`request_mcp_tools` so the model can recover trimmed tools.
- Keep Ask/Plan MCP invoke policy aligned between `modePolicy.ts` and `docs/architecture.md`.

### Anthropic-trained schemas

If adding Anthropic computer/bash/text_editor tools, prefer Anthropic’s published schemas when the active provider is Anthropic — models call them more reliably than novel equivalents. Still execute locally in the Electron harness.

---

## 4. Context & long-horizon agent patterns

1. **Budget layers** — Fixed shares for system / tools / workspace / history / buffer (VYOTIQ `contextBudget.ts`).
2. **Compaction** — Trigger before hard overflow; structured JSON summary with freeform fallback; keep recent N turns intact.
3. **On-demand reading** — Prefer tools that read files as needed over stuffing the whole repo (Claude Code pattern). VYOTIQ’s search/read/glob already support this.
4. **No step ceilings** — Stop on model completion, user abort, or safety circuits — not arbitrary step counts (project rule).
5. **Transcript + receipts** — Persist trajectory/receipts for harness review (VYOTIQ differentiator).

---

## 5. Multi-agent patterns

| Pattern | When to use | VYOTIQ fit |
|---------|-------------|------------|
| Nested subagent (depth 1) | Isolate research or parallel subtasks | Shipped |
| Parallel subagents (small N) | Independent file/areas | Cap 2 today |
| Deep agent teams | Large coordinated refactors | Not shipped; cost/safety tradeoffs — ask before expanding depth |
| Separate subagent model | Cheap worker + strong parent | `subagentProvider` / `subagentModel` settings |

Always isolate nested transcripts; exclude recursive `subagent` to prevent fan-out explosions.

---

## 6. Product UX patterns (coding agents)

- **Modes with hard gates** beat soft prompt-only restrictions.
- **Checkpoints + Keep/Discard** beat silent overwrites.
- **Skills on demand** (Level-1 index + Level-2 body) beat stuffing all skill text into every prompt.
- **Composer capability badges** (Think / Vision / Tools) reduce wrong-model selection.
- **Seed fallback warnings** must be actionable (“start Ollama” / “add API key” / “Cloud routed”).

---

## 7. Testing & verification approaches

- Unit-test host helpers (Ollama local vs cloud), thinking routing, and catalog normalization.
- Mock SSE streams for Responses / Messages / Completions parity.
- Keep marketplace/skills smoke tests when renaming `SKILL.md` conventions.
- For enterprise providers, add contract tests for auth header shapes and base URL path joining (`/openai/deployments/...` vs `/v1`).
- Harness apply should remain gated by eval tests — do not silently rewrite `resources/harness/default.md` without the review loop.

---

## 8. Research hygiene

- Prefer official docs dated in the current year over blog roundups when changing behavior.
- Cross-check one claim against a second source before shipping protocol changes.
- Record model/provider research under `docs/research/` with a research date; update seeds from live catalogs, not from this snapshot alone.
