/** Inject skill body as a strong this-turn instruction plus user trailing text. */
export function formatSkillInvocation(
  skillName: string,
  body: string,
  userText?: string
): string {
  const trailing = (userText ?? '').trim()
  return [
    `[Skill: ${skillName}]`,
    '',
    '<skill instructions>',
    body.trim(),
    '</skill instructions>',
    '',
    'User request:',
    trailing || '(no additional instructions)'
  ].join('\n')
}

/** Cursor-compatible `{{input}}` replacement in workspace command templates. */
export function formatWorkspaceCommand(template: string, userText?: string): string {
  const input = (userText ?? '').trim()
  if (template.includes('{{input}}')) {
    return template.split('{{input}}').join(input)
  }
  if (!input) return template.trim()
  return `${template.trim()}\n\n${input}`
}

/** Agent-mediated MCP tool hint (structured args are out of scope for slash v1). */
export function formatMcpToolInvocation(
  serverId: string,
  toolName: string,
  description: string,
  userText?: string
): string {
  const trailing = (userText ?? '').trim()
  return [
    `Use the MCP tool \`${toolName}\` from server \`${serverId}\`.`,
    description ? `Tool description: ${description}` : null,
    '',
    'Goal / arguments hint:',
    trailing || '(infer reasonable arguments from context)'
  ]
    .filter((line): line is string => line != null)
    .join('\n')
}
