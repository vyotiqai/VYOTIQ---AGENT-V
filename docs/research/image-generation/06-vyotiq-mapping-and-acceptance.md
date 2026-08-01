# 06 — VYOTIQ mapping & acceptance criteria

**Compiled:** 2026-08-01  
**Status:** Slice A+B+C(edit) + status-phase polish + final inline preview implemented. Optional: Responses hosted tool, OpenAI partial-image streaming, local bg-remove.

---

## 1. Shipped

| Capability | Status |
|------------|--------|
| `generate_image` | OpenAI / Gemini / xAI → workspace file |
| `edit_image` | reference_paths (+ optional OpenAI `mask_path`); default overwrite first reference |
| Ask/Plan | Dry-run for both tools |
| Settings | `imageProvider` / `imageModel` |
| Progress UX | Live status phases (resolve → call → write → done) via tool progress |
| Preview UX | Final saved image inline in tool card (`workspace:readImage`) |

## 2. Acceptance

- [x] Generate + edit end-to-end adapters + workspace write
- [x] Path sandbox + checkpoint + approval (Agent)
- [x] Works with non-image chat providers
- [x] Status-phase progress (all providers; no partial-image streaming)
- [x] Inline preview of final workspace image
- [ ] Manual smoke with live keys
- [ ] Responses hosted tool / OpenAI `partial_images` / rembg (optional)

## 3. Pointers

| Area | Paths |
|------|--------|
| Tools | `generateImage.ts`, `editImage.ts` |
| Adapters | `providers/imageGen/` (`generate` + `edit`) |
| Refs | `workspaceImages.ts` |
| Preview IPC | `workspace:readImage` |
| Tool UI | `GenerateImageBody.tsx` |
