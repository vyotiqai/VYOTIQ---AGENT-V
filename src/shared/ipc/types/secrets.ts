import { z } from 'zod'
import { ProviderIdSchema } from '../schemas/providers'

export const SecretProviderSchema = ProviderIdSchema.exclude(['ollama'])
export type SecretProvider = z.infer<typeof SecretProviderSchema>

export const SECRET_PROVIDERS = SecretProviderSchema.options as [
  SecretProvider,
  ...SecretProvider[]
]

export function emptySecretStatus(): Record<SecretProvider, boolean> {
  return Object.fromEntries(SECRET_PROVIDERS.map((p) => [p, false])) as Record<
    SecretProvider,
    boolean
  >
}

export function secretStatusFromKeys(
  keys: Iterable<string>
): Record<SecretProvider, boolean> {
  const set = new Set(keys)
  return Object.fromEntries(SECRET_PROVIDERS.map((p) => [p, set.has(p)])) as Record<
    SecretProvider,
    boolean
  >
}

export type SecretsStatus = {
  encryptionAvailable: boolean
  keys: Record<SecretProvider, boolean>
}

export function emptySecretsStatus(encryptionAvailable = true): SecretsStatus {
  return { encryptionAvailable, keys: emptySecretStatus() }
}

export const SetSecretRequestSchema = z.object({
  provider: SecretProviderSchema,
  key: z.string().trim().min(1, 'API key cannot be empty')
})

export const ClearSecretRequestSchema = z.object({
  provider: SecretProviderSchema
})
