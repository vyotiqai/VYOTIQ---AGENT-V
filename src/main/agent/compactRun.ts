import type { ChatMessage, CompactRunResult, ModelInfo, ProviderId } from '../../shared/ipc'
import { ollamaOpenAiBaseUrl } from '../../shared/domain/providers'
import { DEFAULT_SETTINGS } from '../../shared/ipc'
import { seedModelsFor } from '../../shared/providers'
import { idSuggestsVision } from './providers/normalize'
import { logger } from '../../shared/logger'
import { resolveEffectiveSettings } from '../../shared/effectiveSettings'
import { getSecret } from '@main/settings/secrets'
import { getSettings } from '@main/settings/settings'
import { findWorkspaceSettingsOverride, readWorkspacesState } from '@main/workspace/workspaces'
import { allocateBudget, contentWindow } from './context/budget'
import { compactMessages, preserveRecentMessages } from './context/compact'
import { KEEP_RECENT_TURNS } from './context/types'
import { getProvider, listProviderModels } from './providers'
import { loadCompaction, loadMessages, runExists, saveCompaction } from './state'
import { resolveRunDir } from '@main/storage/paths'

const COMPACT_TIMEOUT_MS = 120_000

const MIN_MESSAGES_TO_COMPACT = 4

export class CompactionUnavailableError extends Error {}

async function resolveModel(
  providerId: ProviderId,
  modelId: string,
  apiKey: string | null,
  baseUrl: string | undefined,
  signal: AbortSignal
): Promise<ModelInfo> {
  try {
    const listed = await listProviderModels({ provider: providerId, apiKey, baseUrl, signal })
    const found = listed.models.find((m) => m.id === modelId)
    if (found) return found
  } catch {
  }
  const seed = seedModelsFor(providerId).find((m) => m.id === modelId)
  if (seed) return seed
  return {
    id: modelId,
    displayName: modelId,
    contextWindow: 128_000,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: true,
    supportsVision: idSuggestsVision(modelId),
    supportsStructuredOutput: providerId !== 'ollama'
  }
}

export async function compactRunNow(input: {
  workspacePath: string
  runId: string
}): Promise<CompactRunResult> {
  if (!runExists(input.workspacePath, input.runId)) {
    throw new CompactionUnavailableError('Run not found')
  }
  const runDir = resolveRunDir(input.workspacePath, input.runId)

  const globalSettings = getSettings()
  const override = findWorkspaceSettingsOverride(readWorkspacesState(), input.workspacePath)
  const settings = {
    ...DEFAULT_SETTINGS,
    ...globalSettings,
    ...resolveEffectiveSettings(globalSettings, override)
  }

  const providerId: ProviderId = settings.provider
  const apiKey = providerId === 'ollama' ? null : getSecret(providerId)
  if (providerId !== 'ollama' && !apiKey) {
    throw new CompactionUnavailableError(`API key for ${providerId} is not set.`)
  }

  const existing = loadCompaction(runDir)
  const folded = existing?.foldedMessages ?? 0
  const all = loadMessages(input.workspacePath, input.runId)
  const working: ChatMessage[] = folded > 0 && folded < all.length ? all.slice(folded) : all

  if (working.length < MIN_MESSAGES_TO_COMPACT) {
    throw new CompactionUnavailableError('Not enough history to compact yet.')
  }

  const keepRecent = settings.keepRecentTurns ?? KEEP_RECENT_TURNS
  const signal = AbortSignal.timeout(COMPACT_TIMEOUT_MS)
  const provider = getProvider(providerId)
  const baseUrl = providerId === 'ollama' ? ollamaOpenAiBaseUrl(settings.ollamaBaseUrl) : undefined
  const model = await resolveModel(providerId, settings.model, apiKey, baseUrl, signal)

  const kept = preserveRecentMessages(
    working,
    keepRecent,
    allocateBudget(model).history,
    model
  )
  const toSummarize = working.slice(0, working.length - kept.length)
  if (!toSummarize.length) {
    throw new CompactionUnavailableError(
      'All of the current history is recent enough to keep verbatim.'
    )
  }

  const record = await compactMessages({
    provider,
    model: model.id,
    apiKey,
    baseUrl,
    signal,
    messages: toSummarize.map(({ thinking: _thinking, ...rest }) => rest),
    supportsStructuredOutput: model.supportsStructuredOutput,
    contextWindow: contentWindow(model)
  })

  if (!record) throw new CompactionUnavailableError('The model returned no summary.')

  const foldedMessages = folded + toSummarize.length
  saveCompaction(runDir, { ...record, foldedMessages })

  logger.info('Manual compaction complete', {
    scope: 'agent',
    correlationId: input.runId,
    provider: providerId,
    messagesBefore: working.length,
    keptMessages: kept.length
  })

  return {
    summary: record.summary,
    tokenEstimate: record.tokenEstimate,
    keptMessages: kept.length,
    messagesBefore: working.length
  }
}
