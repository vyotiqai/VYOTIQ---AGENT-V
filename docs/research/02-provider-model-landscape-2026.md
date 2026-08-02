# Provider & model landscape — mid-2026

**Research date:** 2026-08-01  
**Purpose:** Snapshot of frontier labs, inference specialists, enterprise gateways, and API primitives relevant to a multi-provider coding agent.  
**Caveat:** Model IDs and prices churn weekly. Prefer live `/models` catalogs at runtime; treat this as planning input. Sources listed in [sources.md](./sources.md).

---

## 1. Frontier labs (first-party APIs)

### OpenAI

- **GPT-5.6 family** (GA mid-2026): Sol (flagship), Terra (balanced), Luna (high-volume). Alias `gpt-5.6` typically routes to Sol. Price cuts on Luna/Terra (July 2026) shifted competition toward cost/performance, not only quality.
- **Fast mode:** Replaces Priority Processing for Sol (~2× price for higher tokens/sec); requests tagged `priority` often map to Fast.
- **Responses API:** Positioned as the agentic primitive vs Chat Completions — better cache utilization, multi-turn reasoning items, built-in tools (web search, file search, computer use, code interpreter, image generation, remote MCP). Assistants API deprecation timeline through 2026.
- **Prompt caching:** Implicit for eligible prefixes; GPT-5.6+ adds **explicit cache breakpoints** and longer minimum cache TTL (reported ~30m). Cache writes billed at a premium vs reads.
- **Batch API:** Async jobs at ~50% discount; supports Responses, Chat Completions, embeddings, images, etc.
- **Computer use:** Structured UI actions (`computer` tool / preview variants) requiring a client harness to execute clicks/typing and return screenshots.

Relevant to VYOTIQ: Chat Completions remain the default path except thinking→Responses; hosted tools and Batch are unused; seed IDs still pre–5.6.

### Anthropic

- **Claude Opus 5** (July 2026): Daily-driver flagship pricing in the Opus 4.8 band; Fast mode ~2.5× speed at 2× price. Higher-tier Fable/Mythos line for absolute frontier.
- **API betas:** Mid-conversation tool list changes without invalidating prompt cache; automatic model fallbacks when safety classifiers flag a request.
- **Agent tools (API schemas):** Computer use, bash, text editor, memory, **code execution** (sandboxed, container reuse, programmatic tool calling in newer tool versions).
- **Context management / prompt caching:** `cache_control` on blocks; server-side compaction betas (VYOTIQ already wires Anthropic-native options in agent runs).

Relevant to VYOTIQ: Messages API + thinking + Anthropic context management are in; Anthropic-schema computer/bash/code_execution tools are not hosted — VYOTIQ uses its own tool schemas instead.

### Google (Gemini)

- **Gemini 3.x** Flash / Flash-Lite emphasis on throughput and cost for agent workloads alongside Pro-class models.
- Large context (often ~1M-class) and multimodal input (image/audio/file) remain differentiators.
- Interactions-style APIs for thinking/agent loops (VYOTIQ already routes thinking Gemini to Interactions).

Relevant to VYOTIQ: Seeds still cite 2.0 Flash / 2.5 Pro preview; live catalog should pick up 3.x when keys are present.

### DeepSeek

- **V4 Pro / V4 Flash:** Open-weight MoE family with **1M context**; legacy `deepseek-chat` / `deepseek-reasoner` aliases routed to V4-Flash and scheduled for retirement (reported July 2026).
- Peak-hour surcharge windows reported in secondary pricing trackers — product UIs may want to surface cost risk later.

Relevant to VYOTIQ: Seeds include `deepseek-v4-flash` / `deepseek-v4-pro` (legacy `deepseek-reasoner` removed from seeds; still recognized in context/thinking heuristics). Context table maps V4 to 1M.

### xAI

- **Grok 4.x** line (4.3 / 4.20 / 4.5 / Build variants in secondary trackers); tiered pricing above large prompt thresholds reported (~200K).
- OpenAI-compatible API; long context common on current Grok generations.

Relevant to VYOTIQ: Seed default is `grok-4-latest` (refreshed 2026-08-01).

### Mistral

- **Mistral Large 3**, Ministral / Small / Medium lines with strong price cuts vs prior Large generations; OpenAI-compat endpoints.

Relevant to VYOTIQ: Seed `mistral-large-latest` is alias-friendly; still worth verifying against live catalog.

### Meta open weights (via hosts)

Llama 4 Scout and related MoE/open models appear primarily through **Groq**, Fireworks, Together, Bedrock, OpenRouter — not as a first-party Meta chat API in VYOTIQ.

---

## 2. Inference specialists (OpenAI-compatible)

| Provider | Niche | Integration pattern |
|----------|-------|---------------------|
| **Groq** | Ultra-low latency LPU | Already in VYOTIQ |
| **Cerebras** | Extreme tok/s on focused catalog (incl. GPT-OSS / Llama / Qwen) | OpenAI-compat base URL — **not** first-class |
| **Fireworks** | Broad open-weight catalog, Day-0 OSS, multimodal endpoints | OpenAI-compat — **not** first-class |
| **Together AI** | Widest open catalog + fine-tune / batch discounts | OpenAI-compat — **not** first-class |
| **OpenRouter** | Aggregator / discovery / privacy routing | Already in VYOTIQ (partial substitute for specialists) |
| **Baseten / Modal / HF** | Custom deploys / Hub models | Varying OpenAI-compat fidelity |

**Product implication:** A generic “Custom OpenAI-compatible” provider (base URL + key + optional headers) would unlock Cerebras/Fireworks/Together/local vLLM without N new first-class brands.

---

## 3. Enterprise gateways

| Gateway | Why teams adopt it | VYOTIQ status |
|---------|--------------------|---------------|
| **Azure OpenAI** | Entra ID, private networking, regional data residency | Missing |
| **Amazon Bedrock** | IAM, multi-lab models (Anthropic, Meta, Mistral, OpenAI-on-Bedrock, etc.), AgentCore | Missing |
| **Google Vertex AI** | GCP IAM, Gemini + partners | Missing |

Bedrock’s OpenAI-compatible Responses path for selected OpenAI models still differs from first-party feature parity (computer use / hosted tools often unavailable). Enterprise providers need **region, deployment name, and cloud auth** — not only an API key field.

---

## 4. Coding-agent product patterns (2026)

Cross-reading Cursor / Claude Code / Windsurf comparisons:

| Pattern | Industry practice | VYOTIQ today |
|---------|-------------------|--------------|
| Modes | Ask / Plan / Agent (and sometimes Debug) | Ask / Plan / Agent |
| Skills | On-demand instruction packs (`SKILL.md`, CLAUDE.md) | Marketplace skills + `Skill` tool |
| MCP | External tools/resources | Full client + marketplace |
| Long-horizon autonomy | Terminal agents with large context + on-demand reads | Agent loop + compaction + harness |
| Parallel / agent teams | Multi-agent coordination, “ultra” parallel spend | Nested depth 1, 2 parallel subagents |
| IDE vs terminal | Cursor IDE + Claude Code terminal combo common | Electron IDE-like agent (closer to Cursor product shape) |
| Rules / memory | Project rules + persistent memory | Rules, `.vyotiq/memory`, harness |

Competitive pressure is less “add another chat API” and more **depth of autonomy, cache cost control, enterprise auth, and multimodal I/O**.

---

## 5. Recommended seed targets (documentation only)

Suggested refresh when implementing catalog P0 (do not treat as live API truth):

| Provider | Suggested seeds (planning) |
|----------|----------------------------|
| openai | `gpt-5.6`, `gpt-5.6-terra`, `gpt-5.6-luna` (or current GA aliases from live catalog) |
| anthropic | `claude-opus-5`, latest Sonnet/Haiku GA ids |
| gemini | Latest `gemini-3*` Flash / Pro ids from live catalog |
| deepseek | Keep `deepseek-v4-flash`, `deepseek-v4-pro`; drop or deprecate `deepseek-reasoner` after alias sunset |
| xai | Latest `grok-4*` id from live catalog |
| groq | Llama 4 Scout or current versatile default from live catalog |
| mistral | `mistral-large-latest` (or Large 3 explicit id) |
| ollama | Keep mixed local+cloud examples; prefer ids present on ollama.com when key set |
| openrouter | Keep `openrouter/auto` |

Always prefer live `listModels` when authenticated; seeds only for offline / error UX.
