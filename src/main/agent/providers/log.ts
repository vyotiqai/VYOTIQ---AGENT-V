import { logger } from '../../../shared/logger'
import type { ErrorCode } from '../../../shared/errors'

/** Log provider failures without request bodies, API keys, or response text. */
export function logProviderFailure(
  provider: string,
  kind: 'http' | 'timeout' | 'stream' | 'network',
  detail: { status?: number }
): void {
  const status = detail.status
  const isAuth = status === 401 || status === 403
  const code: ErrorCode = isAuth
    ? 'PROVIDER_AUTH'
    : kind === 'timeout'
      ? 'PROVIDER_TIMEOUT'
      : kind === 'stream'
        ? 'PROVIDER_STREAM'
        : kind === 'network'
          ? 'PROVIDER_HTTP'
          : 'PROVIDER_HTTP'

  const fields = {
    scope: 'provider' as const,
    code,
    provider,
    status,
    kind
  }

  if (isAuth) {
    logger.warn(`Provider ${kind} failure`, fields)
    return
  }
  logger.error(`Provider ${kind} failure`, fields)
}
