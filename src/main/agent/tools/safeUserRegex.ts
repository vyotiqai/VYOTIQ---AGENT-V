/** Max length for agent-supplied regex patterns (terminal wait, grep, etc.). */
export const USER_REGEX_MAX_LENGTH = 200

/**
 * Compile an untrusted regex with length + nested-quantifier guards (ReDoS mitigation).
 * Length alone does not eliminate exponential backtracking; nested quantifiers are rejected
 * as a second line of defense. Prefer RE2/worker timeouts for stronger guarantees later.
 */
export function compileUserRegex(pattern: string, flags?: string): RegExp {
  const trimmed = pattern.trim()
  if (!trimmed) throw new Error('Empty regex pattern')
  if (trimmed.length > USER_REGEX_MAX_LENGTH) {
    throw new Error(`Regex pattern exceeds ${USER_REGEX_MAX_LENGTH} characters`)
  }
  // Classic nested quantifiers: (a+)+, (a*)*, (a+){2,}
  if (/[+*]\)[+*{]/.test(trimmed)) {
    throw new Error('Regex pattern looks too complex (nested quantifiers)')
  }
  try {
    return flags === undefined ? new RegExp(trimmed) : new RegExp(trimmed, flags)
  } catch (err) {
    if (err instanceof Error && /exceeds|too complex|Empty regex/.test(err.message)) throw err
    throw new Error(`Invalid regex pattern: ${pattern}`)
  }
}
