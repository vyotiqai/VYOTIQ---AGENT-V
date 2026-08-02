# Sources & bibliography

**Research date:** 2026-08-01  
**Note:** URLs and product names change. Prefer official docs over secondary roundups when changing code. Secondary sources used for pricing/landscape cross-checks only.

---

## OpenAI (official)

| Source | Use |
|--------|-----|
| [Previewing GPT-5.6 Sol](https://openai.com/index/previewing-gpt-5-6-sol/) | GPT-5.6 Sol/Terra/Luna announcement, pricing, caching notes |
| [Advancing the price-performance frontier with GPT-5.6](https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/) | Luna/Terra price cuts; Fast mode vs Priority |
| [Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses) | Responses vs Chat Completions; built-in tools; Assistants sunset |
| [Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) | Implicit/explicit breakpoints; TTL; usage fields |
| [Computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) | Hosted computer tool / action loop |
| [Batch API](https://developers.openai.com/api/docs/guides/batch) | Async 50% jobs; supported endpoints |
| [OpenAI models in Amazon Bedrock](https://developers.openai.com/api/docs/guides/amazon-bedrock) | Feature parity caveats on Bedrock |

## Anthropic (official)

| Source | Use |
|--------|-----|
| [Introducing Claude Opus 5](https://www.anthropic.com/news/claude-opus-5) | Opus 5 pricing, Fast mode, fallbacks, mid-conversation tool changes |
| [Computer use tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool) | Client-executed computer-use loop |
| [Code execution tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool) | Sandboxed execution, container reuse, programmatic tool calling |
| [How tool use works](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works) | Anthropic-schema tools (bash, text_editor, memory, computer) |

## Google / AWS / enterprise

| Source | Use |
|--------|-----|
| [Amazon Bedrock](https://aws.amazon.com/bedrock/) | Enterprise multi-model platform, AgentCore positioning |
| DataCamp [Best LLM API providers](https://www.datacamp.com/blog/best-llm-api-providers) | Landscape of first-party vs cloud vs OSS hosts |

## Inference specialists & pricing trackers

| Source | Use |
|--------|-----|
| Fireworks [Best LLM API Providers in 2026](https://fireworks.ai/blog/best-llm-api-providers) | Fireworks / Together / Cerebras / Groq comparison |
| Braintrust [Best AI APIs in 2026](https://www.braintrust.dev/articles/best-ai-apis-2026) | Latency/price specialist comparison |
| Awesome Agents [LLM API Pricing Comparison — July 2026](https://awesomeagents.ai/pricing/llm-api-pricing-comparison/) | Cross-lab pricing snapshot (verify before billing logic) |
| DeepSeek [V4 API documentation guide](https://deepseekai.guide/api/deepseek-api-documentation/) | V4 Pro/Flash IDs, 1M context, legacy alias retirement |
| Hugging Face [DeepSeek-V4-Pro](https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro) | Open-weight V4 specs |

## Coding-agent product comparisons

| Source | Use |
|--------|-----|
| [Cursor vs Claude Code vs Windsurf (danilchenko.dev, 2026)](https://www.danilchenko.dev/posts/2026-03-24-cursor-vs-claude-code-vs-windsurf/) | Parallel agents, context, tool combo workflows |
| [Honest comparison DEV Community](https://dev.to/pockit_tools/cursor-vs-windsurf-vs-claude-code-in-2026-the-honest-comparison-after-using-all-three-3gof) | Product posture differences |
| [howaiworks.ai comparison](https://howaiworks.ai/blog/claude-code-vs-cursor-vs-windsurf-which-coding-agent) | Skills, MCP, long-horizon autonomy |
| [CTO guide — Apidots](https://apidots.com/blog/claude-code-vs-cursor-vs-github-copilot-vs-windsurf/) | Team workflow fit |

## Secondary / corroboration only

| Source | Use |
|--------|-----|
| VentureBeat GPT-5.6 Luna price war coverage | Corroborates OpenAI/Anthropic/Google timing |
| Apidog GPT-5.6 pricing explainer | Model ID aliases; verify against OpenAI docs |
| LLMReference DeepSeek vs Grok comparisons | Context/pricing cross-check |

## Image generation (Jun–Aug 2026 package)

Full bibliography and deep-dives live under **[image-generation/sources.md](./image-generation/sources.md)**.

Key official entry points:

| Source | Use |
|--------|-----|
| [OpenAI Image generation](https://developers.openai.com/api/docs/guides/image-generation) | GPT Image / Image API + Responses |
| [OpenAI image_generation tool](https://developers.openai.com/api/docs/guides/tools-image-generation) | Hosted tool loop |
| [Gemini Nano Banana image generation](https://ai.google.dev/gemini-api/docs/image-generation) | Gemini native image models |
| [Gemini Imagen (deprecated)](https://ai.google.dev/gemini-api/docs/imagen) | Do not build new Imagen paths |
| [xAI Imagine image generation](https://docs.x.ai/developers/model-capabilities/images/generation) | OpenAI-compat generations |

---

## Internal codebase evidence

| Path | Use |
|------|-----|
| `src/shared/domain/providers.ts` | Seeds, Ollama routing, provider defaults |
| `src/main/agent/providers/` | Protocol implementations |
| `src/main/agent/tools/modePolicy.ts` | Authoritative mode/MCP gates |
| `src/shared/domain/modelContextWindows.ts` | Known context windows |
| `docs/architecture.md` | Product architecture (check for MCP docs drift) |
| `README.md` | User-facing provider list; no-RAG note |
