import type { ModelInfo, ProviderId } from '../../shared/ipc'
import { seedModelsFor } from '../../shared/providers'
import { idSuggestsVision } from './providers/normalize'
import { listProviderModels } from './providers'

export async function resolveModelInfo(
  providerId: ProviderId,
  modelId: string,
  apiKey: string | null,
  baseUrl: string | undefined,
  signal: AbortSignal
): Promise<ModelInfo> {
  const listed = await listProviderModels({
    provider: providerId,
    apiKey,
    baseUrl,
    signal
  })
  const found = listed.models.find((m) => m.id === modelId)
  if (found) return found
  const seed = seedModelsFor(providerId).find((m) => m.id === modelId)
  if (seed) return seed
  return {
    id: modelId,
    displayName: modelId,
    contextWindow: 128_000,
    inputModalities: ['text'],
    outputModalities: ['text'],
    supportsTools: providerId !== 'ollama' || /tool|coder|qwen|llama3|mistral/i.test(modelId),
    supportsVision: idSuggestsVision(modelId),
    supportsStructuredOutput: providerId !== 'ollama'
  }
}
