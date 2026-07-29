import type {
  BuiltinClientAction,
  SlashCommandDescriptor,
  SlashCommandResolveResult
} from '@shared/ipc'

export type SlashClientHandlers = {
  onCompact?: () => void | Promise<unknown>
  onUndoWrites?: () => void | Promise<unknown>
  onSetAgentMode?: (mode: 'ask' | 'plan' | 'agent') => void | Promise<unknown>
  onOpenMarketplace?: (mcpServerId?: string) => void
  onOpenSettings?: () => void
  onCreateRule?: (title?: string) => void | Promise<unknown>
  onMarketplaceAction?: (
    packageId: string,
    intent: 'install' | 'enable'
  ) => void | Promise<unknown>
  onOpenFile?: (path: string) => void | Promise<unknown>
  onNotice?: (message: string) => void
}

export async function executeSlashResolveResult(
  result: SlashCommandResolveResult,
  handlers: SlashClientHandlers
): Promise<'sent' | 'handled' | 'pending'> {
  switch (result.action) {
    case 'send':
      return 'sent'
    case 'client':
      await runClientAction(result.clientAction, handlers, {
        trailingText: result.trailingText,
        mcpServerId: result.mcpServerId
      })
      return 'handled'
    case 'marketplace':
      await handlers.onMarketplaceAction?.(result.packageId, result.intent)
      return 'pending'
    case 'open_file':
      await handlers.onOpenFile?.(result.path)
      return 'handled'
    default: {
      const _exhaustive: never = result
      return _exhaustive
    }
  }
}

async function runClientAction(
  action: BuiltinClientAction,
  handlers: SlashClientHandlers,
  opts: { trailingText?: string; mcpServerId?: string }
): Promise<void> {
  switch (action) {
    case 'compact':
      await handlers.onCompact?.()
      return
    case 'undo_writes':
      await handlers.onUndoWrites?.()
      return
    case 'set_mode_ask':
      await handlers.onSetAgentMode?.('ask')
      return
    case 'set_mode_plan':
      await handlers.onSetAgentMode?.('plan')
      return
    case 'set_mode_agent':
      await handlers.onSetAgentMode?.('agent')
      return
    case 'open_marketplace':
      handlers.onOpenMarketplace?.(opts.mcpServerId)
      return
    case 'open_settings':
      handlers.onOpenSettings?.()
      return
    case 'create_rule':
      await handlers.onCreateRule?.(opts.trailingText)
      return
    default: {
      const _exhaustive: never = action
      return _exhaustive
    }
  }
}

export function availabilityCtaLabel(
  availability: SlashCommandDescriptor['availability']
): string | null {
  switch (availability) {
    case 'ready':
      return null
    case 'disabled':
      return 'Enable'
    case 'not_installed':
      return 'Install'
    case 'needs_auth':
    case 'disconnected':
      return 'Connect'
    default: {
      const _exhaustive: never = availability
      return _exhaustive
    }
  }
}
