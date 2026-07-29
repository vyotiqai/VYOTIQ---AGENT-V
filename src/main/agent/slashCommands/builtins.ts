import type { SlashCommandDescriptor, SlashCommandResolveResult } from '../../../shared/ipc'

export const BUILTIN_COMMANDS: SlashCommandDescriptor[] = [
  {
    id: 'builtin:compact',
    trigger: 'compact',
    label: 'Compact context',
    description: 'Summarize older messages to free context window space',
    kind: 'builtin',
    group: 'App',
    availability: 'ready'
  },
  {
    id: 'builtin:marketplace',
    trigger: 'marketplace',
    label: 'Open Marketplace',
    description: 'Browse and manage skills, MCP servers, and plugins',
    kind: 'builtin',
    group: 'App',
    availability: 'ready'
  },
  {
    id: 'builtin:settings',
    trigger: 'settings',
    label: 'Open Settings',
    description: 'Open application settings',
    kind: 'builtin',
    group: 'App',
    availability: 'ready'
  },
  {
    id: 'builtin:create-rule',
    trigger: 'create-rule',
    label: 'Create rule',
    description: 'Create a new workspace rule under .vyotiq/rules/',
    kind: 'builtin',
    group: 'App',
    availability: 'ready'
  },
  {
    id: 'builtin:help',
    trigger: 'help',
    label: 'Slash commands',
    description: 'List available slash commands',
    kind: 'builtin',
    group: 'App',
    availability: 'ready'
  },
  {
    id: 'builtin:undo',
    trigger: 'undo',
    label: 'Undo agent writes',
    description: 'Restore files from the last agent write checkpoint for this run',
    kind: 'builtin',
    group: 'App',
    availability: 'ready'
  }
]

export function resolveBuiltin(
  id: string,
  trailingText: string,
  helpMessage: string
): SlashCommandResolveResult | null {
  switch (id) {
    case 'builtin:compact':
      return { action: 'client', clientAction: 'compact' }
    case 'builtin:marketplace':
      return { action: 'client', clientAction: 'open_marketplace' }
    case 'builtin:settings':
      return { action: 'client', clientAction: 'open_settings' }
    case 'builtin:create-rule':
      return {
        action: 'client',
        clientAction: 'create_rule',
        ...(trailingText.trim() ? { trailingText: trailingText.trim() } : {})
      }
    case 'builtin:help':
      return { action: 'send', message: helpMessage }
    case 'builtin:undo':
      return { action: 'client', clientAction: 'undo_writes' }
    default:
      return null
  }
}

export function buildHelpMessage(commands: SlashCommandDescriptor[]): string {
  const lines = [
    'Available slash commands:',
    '',
    ...commands
      .filter((c) => c.availability === 'ready')
      .slice(0, 40)
      .map((c) => `- \`/${c.trigger}\` — ${c.description || c.label}`),
    '',
    'Type `/` in the composer to search all commands.'
  ]
  return lines.join('\n')
}
