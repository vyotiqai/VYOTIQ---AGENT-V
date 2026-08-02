# Capability gap analysis

**Research date:** 2026-08-01  
**Method:** Compare [01-current-state-audit.md](./01-current-state-audit.md) to the mid-2026 landscape in [02-provider-model-landscape-2026.md](./02-provider-model-landscape-2026.md).

Legend: **Have** = shipped and usable · **Partial** = present but incomplete vs industry · **Missing** = not implemented.

---

## 1. Provider & catalog matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Multi-provider chat (9 labs/hosts) | Have | OpenAI, Anthropic, Gemini, Ollama, DeepSeek, Groq, OpenRouter, xAI, Mistral |
| Ollama local + Cloud auto-route | Have | Key + local URL → `https://ollama.com` |
| Live model catalogs + disk cache | Have | 5 min RAM / 7 day disk; seed fallback |
| Seed model freshness | Have (updated 2026-08-01) | Seeds refreshed to GPT-5.6 / Opus 5 / Gemini 3.6 / Grok 4 / Llama 4 Scout |
| Context-window known table | Have (updated 2026-08-01) | GPT-5.6, Gemini 3, Grok 4, DeepSeek V4 covered |
| OpenRouter as aggregator | Partial | Discovery yes; not first-class UX for Cerebras/Fireworks/Together auth/limits |
| Custom OpenAI-compat base URL provider | Missing | Would unlock specialists + vLLM without N providers |
| Azure OpenAI | Missing | Needs deployment/region/Entra patterns |
| Amazon Bedrock | Missing | IAM + model IDs + feature parity caveats |
| Google Vertex AI | Missing | GCP auth + Gemini enterprise path |
| Cerebras / Fireworks / Together first-class | Missing | Reachable only via OpenRouter or future custom base URL |

---

## 2. Protocol & reasoning matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Streaming SSE for all providers | Have | Unified `StreamChunk` types |
| Anthropic Messages + thinking | Have | Adaptive / budget tokens |
| Gemini Interactions for thinking | Have | Falls back to generateContent when thinking off |
| OpenAI Responses for thinking models | Partial | Used when thinking enabled; default chat still Completions |
| Responses-first / built-in hosted tools | Missing | No computer/file_search/code_interpreter/image_gen tools from OpenAI |
| Reasoning state replay across tools | Have | `ProviderReasoningState` |
| Service tiers (flex/priority/Fast) | Have | API still sends `priority`; UI labels it **Fast** |
| Explicit prompt-cache breakpoints (GPT-5.6+) | Missing | `promptCacheKey` present; no breakpoint API |
| Anthropic `cache_control` | Have | System/message caching path |
| Anthropic server-side compaction | Have | Beta options in agent path |
| Batch API (async 50% jobs) | Missing | Not a chat UX priority; useful for evals/harness offline |

---

## 3. Agent product matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Ask / Plan / Agent modes | Have | Hard gates in `modePolicy.ts` |
| Debug interaction mode | Missing | Competitors sometimes expose debug; VYOTIQ intentionally three modes |
| 40+ built-in tools | Have | FS, search, terminal, web, browser, git, memory, diagnostics |
| MCP (stdio/HTTP/SSE) + OAuth | Have | Agent-only invoke (docs drift on Ask/Plan readOnlyHint) |
| Skills / marketplace / slash | Have | Level-1/2 skills, curated catalog |
| Context budgeting + compaction | Have | Client LLM summary + Anthropic native |
| Nested subagents | Partial | Depth 1, ≤2 parallel; industry “agent teams / ultra” go deeper |
| Write checkpoints + undo | Have | Recursive dir delete limitation |
| Harness review/apply | Have | Differentiator vs many coding agents |
| Tool approval modes | Have | off / mutating / all |
| Mid-run follow-ups / ask_question | Have | |
| Auto mode switch | Partial | Behind `autoModeSwitch` setting (default off) |
| MCP slash direct JSON args | Missing | v1 agent-mediated hints only |
| Parallel MCP in Ask via readOnlyHint | Missing by design | Code blocks MCP invoke outside Agent; architecture.md is stale |

---

## 4. Multimodal & I/O matrix

| Capability | Status | Notes |
|------------|--------|-------|
| Vision input (images) | Have | Provider-dependent; strip when unsupported |
| PDF / file input | Partial | Anthropic PDF; Gemini file; OpenAI file mainly Responses path |
| Audio input | Partial | Gemini (and some OpenAI paths); not universal |
| Embeddings API | Missing | Catalog filters embedding models |
| RAG / vector memory over codebase | Missing | README explicit; memory is file notes under `.vyotiq/memory` |
| Image generation | Have | Client tool `generate_image` (OpenAI / Gemini / xAI); Ask/Plan dry-run; research: [image-generation/](./image-generation/README.md) |
| Video generation | Missing | |
| TTS / voice output | Missing | |
| Provider computer-use harness | Missing | Local Electron browser tools instead |
| Provider code-execution sandbox | Missing | Local `terminal` + diagnostics instead |

---

## 5. Seed-model freshness table

| Provider | Current seeds | Mid-2026 expectation | Drift |
|----------|---------------|----------------------|-------|
| openai | `gpt-5.6`, `gpt-5.6-terra`, `gpt-5.6-luna` | GPT-5.6 Sol/Terra/Luna | Low (refreshed) |
| anthropic | `claude-opus-5`, `claude-sonnet-4`, `claude-haiku-4-5` | Opus 5 + current Sonnet/Haiku | Low (refreshed) |
| gemini | `gemini-3.6-flash`, `gemini-2.5-pro` | Gemini 3.x Flash/Pro | Low (refreshed) |
| deepseek | V4 flash/pro | V4 primary | Low |
| xai | `grok-4-latest` | Grok 4.x | Low (refreshed) |
| groq | `llama-4-scout-17b-16e-instruct` | Llama 4 Scout | Low (refreshed) |
| mistral | `mistral-large-latest` | Large 3 via alias | Low |
| ollama | mixed local + cloud samples | OK if cloud key set; local depends on pulls | Low–Medium |
| openrouter | `openrouter/auto` | Still valid aggregator default | Low |

Live catalogs hide most drift when keys work. Drift hurts **first-run**, **offline**, and **ECONNREFUSED** seed fallback UX.

---

## 6. Documentation / consistency gaps

| Issue | Evidence | Impact |
|-------|----------|--------|
| Architecture says Ask/Plan can call MCP with `readOnlyHint` | Fixed 2026-08-01 — docs now match Agent-only MCP invoke | Was misleading for contributors |
| Built-in tool count wording | Architecture lists **44** built-ins (incl. `Skill`, `request_mcp_tools`, `generate_image`) | Aligned 2026-08-01 |
| README “no embedding RAG” | Accurate | Keep until product decision changes |

---

## 7. Gap themes (priority-oriented)

1. **Catalog freshness (cheap)** — seeds + `knownContextWindow` lag frontier IDs.
2. **OpenAI-compat gateway (medium)** — one custom provider covers Cerebras/Fireworks/Together/vLLM.
3. **Responses / cache depth (medium)** — industry moving Responses-first with explicit breakpoints and hosted tools.
4. **Enterprise providers (hard)** — Azure / Bedrock / Vertex auth and regions.
5. **Multimodal expansion (hard, product choice)** — embeddings/RAG, image gen, voice, provider computer use.
6. **Multi-agent depth (product choice)** — deeper nesting vs cost/safety; project forbids step ceilings.

See [05-prioritized-roadmap.md](./05-prioritized-roadmap.md) for P0–P3 mapping to files.
