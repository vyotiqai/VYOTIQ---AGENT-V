import { z } from 'zod'

export const ProviderIdSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'ollama',
  'deepseek',
  'groq',
  'openrouter',
  'xai',
  'mistral'
])
export type ProviderId = z.infer<typeof ProviderIdSchema>

export const InputModalitySchema = z.enum(['text', 'image', 'audio', 'file'])
export const OutputModalitySchema = z.enum(['text', 'image'])

export const ThinkingApiSchema = z.enum([
  'responses',
  'interactions',
  'messages',
  'chat_completions'
])
export type ThinkingApi = z.infer<typeof ThinkingApiSchema>

export const ServiceTierSchema = z.enum(['default', 'flex', 'priority'])
export type ServiceTier = z.infer<typeof ServiceTierSchema>

export const ModelInfoSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  inputModalities: z.array(InputModalitySchema),
  outputModalities: z.array(OutputModalitySchema),
  supportsTools: z.boolean(),
  supportsVision: z.boolean(),
  supportsStructuredOutput: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
  thinkingApi: ThinkingApiSchema.optional(),
  supportedServiceTiers: z.array(ServiceTierSchema).optional()
})
export type ModelInfo = z.infer<typeof ModelInfoSchema>

export const ListModelsRequestSchema = z.object({
  provider: ProviderIdSchema,
  baseUrl: z.string().optional(),
  forceRefresh: z.boolean().optional()
})
export type ListModelsRequest = z.infer<typeof ListModelsRequestSchema>

export const ListModelsResultSchema = z.object({
  models: z.array(ModelInfoSchema),
  warning: z.string().optional()
})
export type ListModelsResult = z.infer<typeof ListModelsResultSchema>
