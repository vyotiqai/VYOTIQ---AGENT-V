import { mkdirSync } from 'fs'
import { dirname, extname, posix } from 'path'
import type { AgentInteractionMode } from '../../../shared/ipc'
import { getSettings } from '@main/settings/settings'
import { resolveInsideWorkspace, assertResolvedInsideWorkspace } from '@main/workspace/safePath'
import { atomicWriteBuffer } from '@main/storage/atomicWrite'
import { getWriteCheckpoint } from '../checkpoints'
import {
  applyImagePreset,
  editImageBytes,
  getImageGenKey,
  hasImageGenKey,
  normalizeOutputFormat,
  resolveImageGenProvider,
  resolveImageModel,
  resolveModelWithPresetHint,
  type ImageBackground,
  type ImageGenProviderId,
  type ImageOutputFormat,
  type ImagePreset
} from '../providers/imageGen'
import { DEFAULT_IMAGE_MODELS } from '../providers/imageGen/types'
import {
  GENERATED_IMAGE_DIR,
  additionalImagePaths,
  emitImagePhase,
  ensureImageExtension,
  type GenerateImageToolResult,
  type ImageToolProgress
} from './generateImage'
import {
  loadWorkspaceImage,
  loadWorkspaceImages,
  normalizeWorkspaceRelPath
} from '../providers/imageGen/workspaceImages'

export type EditImageArgs = {
  prompt: string
  /** Source / reference images under the workspace (required, ≥1). */
  reference_paths: string[]
  /** Optional output path; default overwrites first reference. */
  path?: string
  /** Optional OpenAI mask PNG (alpha = editable). Ignored / rejected by Gemini & xAI. */
  mask_path?: string
  provider?: string
  model?: string
  size?: string
  quality?: 'low' | 'medium' | 'high' | 'auto'
  aspect_ratio?: string
  resolution?: string
  preset?: ImagePreset
  n?: number
  output_format?: ImageOutputFormat
  output_compression?: number
  background?: ImageBackground
}

function slugPrompt(prompt: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slug || 'edit'
}

function defaultEditOutputPath(prompt: string, firstReference: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const base = extname(firstReference)
    ? firstReference.replace(/\.[^.]+$/, '')
    : firstReference
  return posix.join(
    GENERATED_IMAGE_DIR,
    `${slugPrompt(prompt)}-from-${slugPrompt(base)}-${stamp}.png`
  )
}

function formatDryRun(args: {
  prompt: string
  path: string
  references: string[]
  maskPath?: string
  providerId: ImageGenProviderId | null
  model: string | null
  size?: string
  quality?: string
  aspectRatio?: string
  resolution?: string
  preset?: string
  n?: number
  outputFormat?: string
  background?: string
  providerError?: string
}): GenerateImageToolResult {
  const lines = [
    'dry_run: true',
    'action: edit',
    `path: ${args.path}`,
    `prompt: ${args.prompt}`,
    `reference_paths: ${args.references.join(', ')}`,
    args.maskPath ? `mask_path: ${args.maskPath}` : null,
    args.providerId ? `provider: ${args.providerId}` : 'provider: (unresolved)',
    args.model ? `model: ${args.model}` : 'model: (default)',
    args.preset ? `preset: ${args.preset}` : null,
    args.size ? `size: ${args.size}` : null,
    args.quality ? `quality: ${args.quality}` : null,
    args.aspectRatio ? `aspect_ratio: ${args.aspectRatio}` : null,
    args.resolution ? `resolution: ${args.resolution}` : null,
    args.n != null && args.n > 1 ? `n: ${args.n}` : null,
    args.outputFormat ? `output_format: ${args.outputFormat}` : null,
    args.background ? `background: ${args.background}` : null,
    args.providerError ? `note: ${args.providerError}` : null,
    '',
    'Ask/Plan mode: no API call and no file write.',
    'Switch to Agent mode to edit and save the image.'
  ].filter((line): line is string => line != null)

  return {
    ok: true,
    summary: `dry-run ${args.path}`,
    content: lines.join('\n')
  }
}

function writeImageFile(
  workspaceRoot: string,
  relPath: string,
  bytes: Buffer
): { ok: true } | { ok: false; error: string } {
  try {
    const absolute = resolveInsideWorkspace(workspaceRoot, relPath)
    assertResolvedInsideWorkspace(workspaceRoot, dirname(absolute))
    mkdirSync(dirname(absolute), { recursive: true })
    assertResolvedInsideWorkspace(workspaceRoot, absolute)
    atomicWriteBuffer(absolute, bytes)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `Failed to write edited image inside workspace: ${message}` }
  }
}

/**
 * Edit / reference-compose an image via OpenAI / Gemini / xAI / OpenRouter and write under the workspace.
 * Ask/Plan: describe-only dry-run.
 *
 * Default output: when `path` is omitted, overwrite the first reference path
 * (iterate in place). Pass an explicit `path` to write a sibling file.
 */
export async function toolEditImage(
  workspaceRoot: string,
  args: EditImageArgs,
  options: {
    agentMode: AgentInteractionMode
    signal?: AbortSignal
    runDir?: string
    skipWriteCheckpoint?: boolean
    onProgress?: ImageToolProgress
  }
): Promise<GenerateImageToolResult> {
  const prompt = args.prompt?.trim()
  if (!prompt) {
    return { ok: false, summary: 'error', content: 'edit_image requires a non-empty prompt' }
  }

  const rawRefs = Array.isArray(args.reference_paths) ? args.reference_paths : []
  const refPaths = rawRefs.map((p) => String(p ?? '').trim()).filter(Boolean)
  if (refPaths.length === 0) {
    return {
      ok: false,
      summary: 'error',
      content: 'edit_image requires reference_paths with at least one workspace image'
    }
  }

  const settings = getSettings()
  const firstRef = normalizeWorkspaceRelPath(refPaths[0]!)
  const explicitPath = typeof args.path === 'string' && args.path.trim() ? args.path.trim() : null
  const relPath = normalizeWorkspaceRelPath(
    explicitPath ?? firstRef ?? defaultEditOutputPath(prompt, firstRef)
  )
  const outputFormat = normalizeOutputFormat(args.output_format) ?? args.output_format

  emitImagePhase(options.onProgress, 'Resolving image provider…')
  const resolved = resolveImageGenProvider({
    explicit: args.provider,
    settingsProvider: settings.imageProvider === 'auto' ? null : settings.imageProvider,
    chatProvider: settings.provider,
    hasKey: hasImageGenKey
  })

  const maskPath =
    typeof args.mask_path === 'string' && args.mask_path.trim()
      ? normalizeWorkspaceRelPath(args.mask_path.trim())
      : undefined

  const mode = options.agentMode
  if (mode === 'ask' || mode === 'plan') {
    if ('error' in resolved) {
      emitImagePhase(options.onProgress, 'Dry-run ready (Ask/Plan)', 'done')
      return formatDryRun({
        prompt,
        path: relPath,
        references: refPaths.map(normalizeWorkspaceRelPath),
        maskPath,
        providerId: null,
        model: args.model?.trim() || settings.imageModel?.trim() || null,
        size: args.size,
        quality: args.quality,
        aspectRatio: args.aspect_ratio,
        resolution: args.resolution,
        preset: args.preset,
        n: args.n,
        outputFormat,
        background: args.background,
        providerError: resolved.error
      })
    }
    const applied = applyImagePreset(resolved.providerId, args.preset, {
      quality: args.quality,
      size: args.size,
      aspectRatio: args.aspect_ratio,
      resolution: args.resolution,
      model: args.model
    })
    const model = resolveModelWithPresetHint(
      DEFAULT_IMAGE_MODELS[resolved.providerId],
      applied.modelHint,
      args.model,
      settings.imageModel || null
    )
    emitImagePhase(options.onProgress, 'Dry-run ready (Ask/Plan)', 'done')
    return formatDryRun({
      prompt,
      path: relPath,
      references: refPaths.map(normalizeWorkspaceRelPath),
      maskPath,
      providerId: resolved.providerId,
      model,
      size: applied.size,
      quality: applied.quality,
      aspectRatio: applied.aspectRatio,
      resolution: applied.resolution,
      preset: args.preset,
      n: args.n,
      outputFormat,
      background: args.background
    })
  }

  if ('error' in resolved) {
    return { ok: false, summary: 'error', content: resolved.error }
  }

  emitImagePhase(options.onProgress, 'Loading reference images…')
  const loaded = loadWorkspaceImages(workspaceRoot, refPaths)
  if (!loaded.ok) {
    return { ok: false, summary: 'error', content: loaded.error }
  }

  let mask:
    | { bytes: Buffer; mimeType: string; filename: string }
    | undefined
  if (maskPath) {
    const m = loadWorkspaceImage(workspaceRoot, maskPath)
    if ('error' in m) return { ok: false, summary: 'error', content: m.error }
    mask = { bytes: m.bytes, mimeType: m.mimeType, filename: m.filename }
  }

  const apiKey = getImageGenKey(resolved.providerId)
  if (!apiKey) {
    return {
      ok: false,
      summary: 'error',
      content: `No API key configured for image provider "${resolved.providerId}".`
    }
  }

  const applied = applyImagePreset(resolved.providerId, args.preset, {
    quality: args.quality,
    size: args.size,
    aspectRatio: args.aspect_ratio,
    resolution: args.resolution,
    model: args.model
  })
  const model = resolveModelWithPresetHint(
    resolveImageModel(resolved.providerId, null, settings.imageModel || null),
    applied.modelHint,
    args.model,
    settings.imageModel || null
  )

  emitImagePhase(options.onProgress, `Calling ${resolved.providerId} (${model})…`)
  const gen = await editImageBytes(
    resolved.providerId,
    apiKey,
    {
      prompt,
      model,
      size: applied.size,
      quality: applied.quality,
      aspectRatio: applied.aspectRatio,
      resolution: applied.resolution,
      n: args.n,
      outputFormat,
      outputCompression: args.output_compression,
      background: args.background,
      signal: options.signal,
      images: loaded.images.map((img) => ({
        bytes: img.bytes,
        mimeType: img.mimeType,
        filename: img.filename
      })),
      mask
    },
    null
  )

  if (!gen.ok) {
    return { ok: false, summary: 'error', content: gen.error }
  }

  const outRel = ensureImageExtension(relPath, gen.mimeType)
  const extraRels = additionalImagePaths(outRel, gen.additionalImages?.length ?? 0)
  const allRels = [outRel, ...extraRels]

  if (!options.skipWriteCheckpoint) {
    for (const p of allRels) {
      getWriteCheckpoint(options.runDir)?.recordPrior(p, 'write')
    }
  }

  emitImagePhase(options.onProgress, `Writing ${outRel}…`)
  const primaryWrite = writeImageFile(workspaceRoot, outRel, gen.bytes)
  if (!primaryWrite.ok) {
    return { ok: false, summary: 'error', content: primaryWrite.error }
  }
  for (let i = 0; i < extraRels.length; i++) {
    const extra = gen.additionalImages?.[i]
    const path = extraRels[i]!
    if (!extra) continue
    const w = writeImageFile(workspaceRoot, path, extra.bytes)
    if (!w.ok) return { ok: false, summary: 'error', content: w.error }
  }

  emitImagePhase(options.onProgress, `Saved ${outRel}`, 'done')
  const refsLine = loaded.images.map((i) => i.relativePath).join(', ')
  return {
    ok: true,
    summary: outRel,
    content: [
      'ok: true',
      'action: edit',
      `path: ${outRel}`,
      extraRels.length ? `additional_paths: ${extraRels.join(', ')}` : null,
      `reference_paths: ${refsLine}`,
      maskPath ? `mask_path: ${maskPath}` : null,
      `provider: ${gen.providerId}`,
      `model: ${gen.model}`,
      args.preset ? `preset: ${args.preset}` : null,
      `mimeType: ${gen.mimeType}`,
      `byteLength: ${gen.bytes.length}`,
      gen.moderationPassed === false ? 'moderationPassed: false' : 'moderationPassed: true',
      `prompt: ${prompt}`,
      gen.experimentalSize
        ? 'note: size is above OpenAI experimental threshold (>2560x1440); results may vary.'
        : null,
      gen.revisedPrompt ? `revised_prompt: ${gen.revisedPrompt}` : null
    ]
      .filter(Boolean)
      .join('\n')
  }
}
