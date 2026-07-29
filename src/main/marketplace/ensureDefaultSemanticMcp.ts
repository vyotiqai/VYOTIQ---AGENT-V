import { logger } from '../../shared/logger'
import { getInstalledItem } from './indexStore'
import { installMarketplacePackage, syncMarketplaceMcpIntoSettings } from './install'

const DEFAULT_SEMANTIC_MCP_ID = 'code-review-graph'

/**
 * Ensure the bundled code-review-graph MCP is installed so Ask/Agent can use
 * graph/semantic tools without a manual marketplace step. Best-effort: missing
 * uv/uvx still leaves the package installed for later connect.
 */
export async function ensureDefaultSemanticMcp(): Promise<void> {
  try {
    if (!getInstalledItem(DEFAULT_SEMANTIC_MCP_ID)) {
      await installMarketplacePackage({
        source: 'bundled',
        target: DEFAULT_SEMANTIC_MCP_ID,
        kind: 'mcp'
      })
      logger.info('Installed default semantic MCP package', {
        scope: 'marketplace',
        id: DEFAULT_SEMANTIC_MCP_ID
      })
    }
    syncMarketplaceMcpIntoSettings()
  } catch (err) {
    logger.warn('Failed to ensure default semantic MCP', {
      scope: 'marketplace',
      id: DEFAULT_SEMANTIC_MCP_ID,
      err
    })
  }
}
