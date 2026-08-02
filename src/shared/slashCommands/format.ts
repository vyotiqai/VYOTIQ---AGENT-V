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

export type ParsedSkillInvocation = {
  skillName: string
  body: string
  /** Empty when the template used `(no additional instructions)`. */
  userRequest: string
}

const SKILL_HEADER_RE = /^\[Skill:\s*([^\]]+)\]\s*\n\n<skill instructions>\n/
const SKILL_CLOSER = '\n</skill instructions>\n\nUser request:\n'

/**
 * Parse a message produced by `formatSkillInvocation`.
 * Uses the last closer so skill bodies may document `</skill instructions>` / `User request:`.
 */
export function parseSkillInvocation(text: string): ParsedSkillInvocation | null {
  const raw = text.trim()
  const header = SKILL_HEADER_RE.exec(raw)
  if (!header) return null
  const skillName = (header[1] ?? '').trim()
  if (!skillName) return null
  const afterOpen = raw.slice(header[0].length)
  const closeIdx = afterOpen.lastIndexOf(SKILL_CLOSER)
  if (closeIdx < 0) return null
  const body = afterOpen.slice(0, closeIdx).trim()
  const rawRequest = afterOpen.slice(closeIdx + SKILL_CLOSER.length).trim()
  const userRequest =
    rawRequest === '(no additional instructions)' ? '' : rawRequest
  return { skillName, body, userRequest }
}

/** Compact timeline / queue preview — skill name + user request, no body. */
export function skillInvocationDisplayText(parsed: ParsedSkillInvocation): string {
  const nameLine = `/${parsed.skillName}`
  if (!parsed.userRequest) return nameLine
  return `${nameLine}\n\n${parsed.userRequest}`
}

/** Edit-composer draft that re-resolves via slash submit on send. */
export function skillInvocationEditDraft(parsed: ParsedSkillInvocation): string {
  if (!parsed.userRequest) return `/${parsed.skillName}`
  return `/${parsed.skillName} ${parsed.userRequest}`
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

export type ParsedMcpToolInvocation = {
  serverId: string
  toolName: string
  /** Empty when the template used the infer-placeholder. */
  userRequest: string
}

const MCP_HEADER_RE = /^Use the MCP tool `([^`]+)` from server `([^`]+)`\.\n/
const MCP_GOAL_MARKER = '\nGoal / arguments hint:\n'

/**
 * Parse a message produced by `formatMcpToolInvocation`.
 * Uses the last goal marker so tool descriptions may be multi-line.
 */
export function parseMcpToolInvocation(text: string): ParsedMcpToolInvocation | null {
  const raw = text.trim()
  const header = MCP_HEADER_RE.exec(raw)
  if (!header) return null
  const toolName = (header[1] ?? '').trim()
  const serverId = (header[2] ?? '').trim()
  if (!toolName || !serverId) return null
  const afterHeader = raw.slice(header[0].length)
  const goalIdx = afterHeader.lastIndexOf(MCP_GOAL_MARKER)
  if (goalIdx < 0) return null
  // Optional `Tool description: …` (may span lines) sits before the goal marker.
  const rawRequest = afterHeader.slice(goalIdx + MCP_GOAL_MARKER.length).trim()
  const userRequest =
    rawRequest === '(infer reasonable arguments from context)' ? '' : rawRequest
  return { serverId, toolName, userRequest }
}

/** Compact timeline / queue preview for MCP slash sends. */
export function mcpInvocationDisplayText(parsed: ParsedMcpToolInvocation): string {
  const nameLine = `/${parsed.serverId}-${parsed.toolName}`
  if (!parsed.userRequest) return nameLine
  return `${nameLine}\n\n${parsed.userRequest}`
}

/** Display text for any user message; skill/MCP injections collapse to a summary. */
export function userMessageDisplayText(text: string): string {
  const skill = parseSkillInvocation(text)
  if (skill) return skillInvocationDisplayText(skill)
  const mcp = parseMcpToolInvocation(text)
  if (mcp) return mcpInvocationDisplayText(mcp)
  return text
}
