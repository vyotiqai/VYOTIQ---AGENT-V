import { logger } from '../../../shared/logger'
import type { ErrorCode } from '../../../shared/errors'

/** Log provider failures without request bodies, API keys, or full response text. */
export function logProviderFailure(
  provider: string,
  kind: 'http' | 'timeout' | 'stream' | 'network' | 'parse',
  detail: { status?: number; bytes?: number; message?: string }
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
    ...(detail.bytes !== undefined ? { bytes: detail.bytes } : {}),
    ...(detail.message ? { message: detail.message } : {})
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
  // Non-auth 4xx: warn with scrubbed message so operators can diagnose without secrets.
  if (kind === 'http' && status !== undefined && status >= 400 && status < 500) {
    logger.warn(`Provider ${kind} failure`, fields)
    return
  }
  logger.error(`Provider ${kind} failure`, fields)
}
