# 01 — Current VYOTIQ audit (shipped image stack)

**Compiled:** 2026-08-01  
**Scope:** Code as of this research day — what is wired, what is partial, what is absent.  
**Confidence:** Verified against repo files listed below.

---

## 1. Architecture (shipped)

```
Agent loop
  → generate_image / edit_image
    → resolveImageGenProvider (explicit → settings → chat if openai|gemini|xai → openai→gemini→xai by key)
    → adapter.generate | adapter.edit
    → atomicWriteBuffer → workspace path (.vyotiq/generated/ default)
    → onProgress status phases
    → GenerateImageBody → workspace:readImage inline preview
```

**Design choice (intact):** Client tools own the spine. Chat provider may be Anthropic/Ollama/etc.; image calls use a separate image-capable key.

---

## 2. File inventory

| Layer | Paths |
|-------|--------|
| Types / router | `src/main/agent/providers/imageGen/types.ts`, `index.ts` |
| Adapters | `openai.ts`, `gemini.ts`, `xai.ts` |
| Workspace refs | `workspaceImages.ts` |
| Tools | `src/main/agent/tools/generateImage.ts`, `editImage.ts` |
| Schemas | `src/main/agent/schemas/tools.ts` (`generateImageArgs`, `editImageArgs`) |
| Handlers | `src/main/agent/tools/index.ts` |
| Policy | `modePolicy.ts`, `executeStepTools.ts` (Ask/Plan dry-run skip approval) |
| Settings | `src/shared/ipc/schemas/settings.ts` — `imageProvider`, `imageModel` |
| UI | `AgentSection.tsx`, `GenerateImageBody.tsx`, toolUi registry/parsers |
| Preview IPC | `workspace:readImage` (`channels.ts`, `register.ts`, preload) |
| Tests | `tests/main/unit/generateImage.test.ts`, mode/classify schema tests |
| Harness | `resources/harness/default.md` |

---

## 3. Providers & defaults

| ID | Default model | Generate | Edit | Mask |
|----|---------------|----------|------|------|
| `openai` | `gpt-image-2` | `/v1/images/generations` | multipart `/v1/images/edits` | Yes |
| `gemini` | `gemini-3.1-flash-image` | `generateContent` + `TEXT`+`IMAGE` | inline refs | No |
| `xai` | `grok-imagine-image-quality` | `/v1/images/generations` | `/v1/images/edits` data-URI | No (max 3 refs) |

Keys reuse chat provider secrets (`getSecret('openai'|'gemini'|'xai')`).

---

## 4. Tool arguments (exposed)

**Shared:** `prompt`, `path?`, `provider?`, `model?`, `size?` (OpenAI), `quality?` (OpenAI), `aspect_ratio?` (Gemini/xAI), `resolution?` (Gemini/xAI).

**edit_image only:** `reference_paths` (1–16; xAI capped at 3 in adapter), `mask_path?` (OpenAI).

**Hardcoded in adapters:** `n: 1`; OpenAI always treats output as PNG mime in parser; no `output_format` / `output_compression` / `background` / `moderation` args; no OpenAI size constraint validation before request.

---

## 5. Modes & UX

| Mode | Behavior |
|------|----------|
| Ask / Plan | Dry-run: resolve provider/model/path; no HTTP; no write |
| Agent | Full call + checkpoint + approval (unless dry-run) |

**Progress:** Status phases only (resolve → load refs → call → write → saved). No partial image bytes.

**Preview:** Final workspace file via `workspace:readImage` data URL in tool card.

---

## 6. Gap checklist (vs mid-2026 primary docs)

| Gap | Severity | Notes |
|-----|----------|-------|
| HQ params missing (`format`, `compression`, `background`, `n`) | High | OpenAI + OpenRouter docs expose them |
| No OpenAI size constraint validation | Medium | Easy 400s on invalid WxH |
| No `gemini-3-pro-image` / Lite defaults in UI | Low | User can set `imageModel` |
| OpenRouter not wired | High if “all aggregators” required | Dedicated Image API exists (Verified primary) |
| Custom OpenAI-compat `/v1/images` not wired | Medium | Feature-detect needed |
| Anthropic/Ollama/DeepSeek/Groq/Mistral | N/A or Missing | No first-party gen — must auto-route elsewhere |
| Responses hosted `image_generation` | Optional | Alternate spine; client tools already work |
| Partial image streaming | Optional | Extra cost/complexity; status phases already ship |
| Code-native SVG/HTML/UI tool | Missing | Agent can write files via edit tools; no dedicated visual tool |
| Motion / video | Missing | xAI video API verified; code-native CSS/SVG motion not guided in harness |
| Manual live-key smoke | Open | Acceptance leftover |

---

## 7. What already works well

- Multi-provider day-one adapters with clear error mapping (moderation, org verification).
- Chat provider independence (Anthropic chat + OpenAI image key).
- Edit loop with overwrite-first-reference default.
- Ask/Plan dry-run policy.
- Inline final preview + status phases.
- Unit tests covering routing, dry-run, progress, provider rejections for masks.

---

## 8. Stale docs to fix in follow-up (not this package’s code)

- [`../image-generation/README.md`](../image-generation/README.md) still says “no product code” — implementation exists; this package supersedes for “finish” planning.
- Roadmap P3 image row still says “research package ready / blocked” in places — update when implementing finish plan.
