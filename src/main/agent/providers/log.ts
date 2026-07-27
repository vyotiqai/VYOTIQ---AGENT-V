import { logger } from '../../../shared/logger'
import type { ErrorCode } from '../../../shared/errors'

/** Log provider failures without request bodies, API keys, or response text. */
export function logProviderFailure(
  provider: string,
  kind: 'http' | 'timeout' | 'stream' | 'network' | 'parse',
  detail: { status?: number; bytes?: number }
): void {
  const status = detail.status
  const isAuth = status === 401 || status === 403
  const isBilling = status === 402
  const code: ErrorCode = isAuth
    ? 'PROVIDER_AUTH'
    : kind === 'timeout'
      ? 'PROVIDER_TIMEOUT'
      : kind === 'stream' || kind === 'parse'
        ? 'PROVIDER_STREAM'
        : 'PROVIDER_HTTP'

  const fields = {
    scope: 'provider' as const,
    code,
    provider,
    status,
    kind,
    ...(detail.bytes !== undefined ? { bytes: detail.bytes } : {})
  }

  if (isAuth || isBilling) {
    logger.warn(`Provider ${kind} failure`, fields)
    return
  }
  // A dropped frame degrades one turn; it is not the whole request failing.
  if (kind === 'parse') {
    logger.warn('Provider stream frame dropped (unparseable JSON)', fields)
    return
  }
  logger.error(`Provider ${kind} failure`, fields)
}
